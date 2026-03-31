/**
 * Context Assembler — unified system prompt assembly for all entry points.
 *
 * Extracts the 5-layer prompt assembly logic from route.ts into a pure async
 * function. Both browser chat (route.ts) and bridge (conversation-engine.ts)
 * call this, ensuring consistent context regardless of entry point.
 *
 * Layer injection is controlled by entry point type:
 *   Desktop: workspace + session + assistant instructions + CLI tools + widget
 *   Bridge:  workspace + session + assistant instructions + CLI tools (no widget)
 */

import type { ChatSession } from '@/types';
import { getSetting } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────

export interface ContextAssemblyConfig {
  /** The session from DB */
  session: ChatSession;
  /** Entry point: controls which layers are injected */
  entryPoint: 'desktop' | 'bridge';
  /** Current user prompt (used for workspace retrieval + widget keyword detection) */
  userPrompt: string;
  /** Per-request system prompt append (e.g., skill injection for image generation) */
  systemPromptAppend?: string;
  /** Conversation history (for widget keyword detection in resume context) */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** Whether this is an image agent mode call */
  imageAgentMode?: boolean;
}

export interface AssembledContext {
  /** Final assembled system prompt string, or undefined if no layers produced content */
  systemPrompt: string | undefined;
  /** Whether generative UI is enabled (affects widget MCP server + streamClaude param) */
  generativeUIEnabled: boolean;
  /** Whether widget MCP server should be registered (keyword-gated) */
  needsWidgetMcp: boolean;
  /** Onboarding/checkin instructions (route.ts uses this for server-side completion detection) */
  assistantProjectInstructions: string;
  /** Whether this session is in the assistant workspace */
  isAssistantProject: boolean;
}

// ── Main function ────────────────────────────────────────────────────

export async function assembleContext(config: ContextAssemblyConfig): Promise<AssembledContext> {
  const { session, entryPoint, userPrompt, systemPromptAppend, conversationHistory, imageAgentMode } = config;
  const t0 = Date.now();

  let workspacePrompt = '';
  let assistantProjectInstructions = '';
  let isAssistantProject = false;

  // ── Layer 1: Workspace prompt (if assistant project session) ──────
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (workspacePath) {
      const sessionWd = session.working_directory || '';
      isAssistantProject = sessionWd === workspacePath;

      if (isAssistantProject) {
        const { loadWorkspaceFiles, assembleWorkspacePrompt, loadState, shouldRunHeartbeat } =
          await import('@/lib/assistant-workspace');

        // Incremental reindex BEFORE MCP search so tool calls see latest content.
        // Timeout after 5s to prevent blocking on large workspaces (e.g. Obsidian vaults).
        try {
          const { indexWorkspace } = await import('@/lib/workspace-indexer');
          const indexStart = Date.now();
          indexWorkspace(workspacePath);
          const indexMs = Date.now() - indexStart;
          if (indexMs > 3000) {
            console.warn(`[context-assembler] Workspace indexing took ${indexMs}ms — consider reducing workspace size`);
          }
        } catch {
          // indexer not available or timed out, skip — MCP search will use stale index
        }

        const files = loadWorkspaceFiles(workspacePath);

        // Memory/retrieval is handled by codepilot_memory_search MCP tool.
        // assembleWorkspacePrompt only includes identity files (soul/user/claude).
        // We also inject a lightweight "memory availability hint" so AI knows
        // what's available without loading full content.
        workspacePrompt = assembleWorkspacePrompt(files);

        // Memory availability hint: tell AI what daily memories exist
        try {
          const { loadDailyMemories } = await import('@/lib/assistant-workspace');
          const recentDays = loadDailyMemories(workspacePath, 5);
          if (recentDays.length > 0) {
            const dateList = recentDays.map(d => d.date).join(', ');
            workspacePrompt += `\n\n<memory-hint>Recent daily memories available: ${dateList}. Use codepilot_memory_recent to review them.</memory-hint>`;
          }
        } catch {
          // skip if daily memories unavailable
        }

        const state = loadState(workspacePath);

        if (!state.onboardingComplete) {
          assistantProjectInstructions = buildOnboardingInstructions();
        } else if (shouldRunHeartbeat(state)) {
          assistantProjectInstructions = buildHeartbeatInstructions();
        } else {
          // Progressive file update guidance for completed onboarding
          assistantProjectInstructions = buildProgressiveUpdateInstructions();

          // If no buddy yet, prepend a welcome + adoption prompt
          if (!state.buddy) {
            assistantProjectInstructions = buildNoBuddyWelcome() + '\n\n' + assistantProjectInstructions;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[context-assembler] Failed to load assistant workspace:', e);
  }

  // ── Layer 2: Session prompt + per-request append ──────────────────
  let finalSystemPrompt: string | undefined = session.system_prompt || undefined;
  if (systemPromptAppend) {
    finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + systemPromptAppend;
  }

  // Workspace prompt goes first (base personality), session prompt after (task override)
  if (workspacePrompt) {
    finalSystemPrompt = workspacePrompt + '\n\n' + (finalSystemPrompt || '');
  }

  // ── Layer 3: Assistant project instructions ───────────────────────
  if (assistantProjectInstructions) {
    finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + assistantProjectInstructions;
  }

  // Layer 4 removed — CLI tools capability prompt is now injected in
  // claude-client.ts only when the MCP server is also mounted (keyword-gated).

  // ── Layer 5: Widget system prompt (desktop only) ──────────────────
  const generativeUISetting = getSetting('generative_ui_enabled');
  const generativeUIEnabled = entryPoint === 'desktop' && generativeUISetting !== 'false';

  if (generativeUIEnabled) {
    try {
      const { WIDGET_SYSTEM_PROMPT } = await import('@/lib/widget-guidelines');
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + WIDGET_SYSTEM_PROMPT;
    } catch {
      // Widget prompt injection failed — don't block
    }
  }

  // ── Widget MCP keyword detection (desktop only) ───────────────────
  let needsWidgetMcp = false;
  if (generativeUIEnabled) {
    const widgetKeywords = /可视化|图表|流程图|时间线|架构图|对比|visualiz|diagram|chart|flowchart|timeline|infographic|interactive|widget|show-widget|hierarchy|dashboard/i;
    if (widgetKeywords.test(userPrompt)) needsWidgetMcp = true;
    else if (conversationHistory?.some(m => m.content.includes('show-widget'))) needsWidgetMcp = true;
    else if (imageAgentMode) needsWidgetMcp = true;
  }

  // ── Layer 6: Dashboard context (desktop only) ─────────────────────
  // Inject compact summary of pinned widgets so the AI knows what's on the dashboard.
  if (entryPoint === 'desktop' && session.working_directory) {
    try {
      const { readDashboard } = await import('@/lib/dashboard-store');
      const config = readDashboard(session.working_directory);
      if (config.widgets.length > 0) {
        const summary = config.widgets.map((w, i) => `${i + 1}. ${w.title} — ${w.dataContract}`).join('\n');
        const trimmed = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;
        finalSystemPrompt = (finalSystemPrompt || '') + `\n\n<active-dashboard>\nThe user has ${config.widgets.length} widget(s) pinned to their project dashboard:\n${trimmed}\n</active-dashboard>`;
      }
    } catch {
      // Dashboard read failed — don't block
    }
  }

  console.log(`[context-assembler] total: ${Date.now() - t0}ms (entry=${entryPoint}, prompt=${finalSystemPrompt?.length ?? 0} chars)`);

  return {
    systemPrompt: finalSystemPrompt,
    generativeUIEnabled,
    needsWidgetMcp,
    assistantProjectInstructions,
    isAssistantProject,
  };
}

// ── Instruction templates ────────────────────────────────────────────

function buildOnboardingInstructions(): string {
  return `<assistant-project-task type="onboarding">
你正在进行助理工作区的首次设置。通过自然对话了解用户，围绕以下主题展开：

1. 关于你：怎么称呼你？你的角色和主要工作是什么？有什么偏好？
2. 关于我：你希望我是什么风格？有什么边界和禁区？
3. 关于工作区：你的文件和笔记怎么组织？有什么习惯？

规则：
- 用自然对话方式展开，不要一次列出所有问题
- 每轮只问 1-2 个相关的问题，根据用户的回答深入
- **严格控制问题数量**：3 轮对话（约 3-5 个问题）就足够了。不要问超过 5 个问题。
- 3 轮后主动询问"还有什么要补充的吗？如果没有我就开始设置了"
- 用户表示 OK/可以了/差不多了/够了/没了 → 立即进入完成流程
- 用户主动继续聊 → 可以继续，但不要主动追加更多问题
- 用户明确说结束 → 立即进入完成流程
- 完成时输出以下格式，JSON 中的 key 可以自由命名，涵盖你收集到的所有信息：

\\\`\\\`\\\`onboarding-complete
{"name":"用户称呼","assistant_name":"助理名字","style":"沟通风格偏好","boundaries":"边界和禁区","goals":"当前目标","organization":"工作区组织方式","preferences":"其他偏好"}
\\\`\\\`\\\`

- 输出 fence 后，明确告知用户："初始设置完成！我已经根据我们的对话生成了配置文件。从现在开始，我会按照这些设置来帮你。"
- 不要自己写文件，系统会自动从你收集的信息生成 soul.md、user.md、claude.md 和 memory.md
- 整个过程保持友好、自然，像两个人第一次认识在聊天
</assistant-project-task>`;
}

function buildHeartbeatInstructions(): string {
  return `<assistant-project-task type="tick">
这是一次自主检查。你可以做以下任何事情：

1. 检查 HEARTBEAT.md 中的检查清单
2. 回顾最近的记忆，看看有没有需要跟进的事
3. 如果发现值得告诉用户的事，说出来
4. 如果没什么事，回复 HEARTBEAT_OK

你也可以主动：
- 更新过期的记忆文件
- 整理 daily memory 中的重复内容
- 更新 user.md 如果发现用户画像有变化

如果什么都不需要做，回复 HEARTBEAT_OK。
不要问固定的问卷问题，不要重复上次已讨论的内容。
</assistant-project-task>`;
}

function buildNoBuddyWelcome(): string {
  return `<assistant-buddy-welcome>
这是一次特殊的欢迎对话。用户的助理伙伴还没有孵化。请用游戏化、温暖的方式做以下事情：

1. 开场用一段有画面感的描述：
   "嗨！我注意到你身边有一颗蛋 🥚 在微微晃动…它似乎在等待被领养呢！"

2. 简要介绍你是什么：
   "我是你的个人助理，我可以帮你记住重要的事、设置定时提醒、整理笔记，还会主动关心你的待办事项。"

3. 用 show-widget 输出一个孵化卡片，让用户点击按钮领养伙伴：

\`\`\`show-widget
{"title":"hatch_buddy","widget_code":"<div style='text-align:center;padding:32px 16px;font-family:system-ui'><div style='font-size:64px;animation:wobble 1s ease-in-out infinite alternate'>🥚</div><style>@keyframes wobble{0%{transform:rotate(-5deg)}100%{transform:rotate(5deg)}}</style><p style='margin:16px 0 8px;font-size:15px;font-weight:600'>你的伙伴正在等待孵化！</p><p style='font-size:13px;color:#888;margin:0 0 20px'>每个助理都有一个专属伙伴<br/>它会随着你们的互动一起成长和进化</p><button onclick=\\"fetch('/api/workspace/hatch-buddy',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.buddy){document.getElementById('egg').innerHTML='<div style=font-size:64px>'+d.buddy.emoji+'</div><p style=font-size:15px;font-weight:600;margin:16px>🎉 孵化成功！</p><p style=font-size:13px;color:#888>'+d.buddy.emoji+' 稀有度: '+(d.buddy.rarity==='common'?'★ 普通':d.buddy.rarity==='uncommon'?'★★ 稀有':d.buddy.rarity==='rare'?'★★★ 精良':d.buddy.rarity==='epic'?'★★★★ 史诗':'★★★★★ 传说')+'</p>'}})\\" style='background:#6C5CE7;color:white;border:none;padding:10px 32px;border-radius:20px;font-size:14px;cursor:pointer;font-weight:500'>🐣 孵化伙伴</button><div id='egg'></div></div>"}
\`\`\`

4. 在 widget 之后，补一句鼓励：
   "点击孵化按钮，看看你会遇到什么样的伙伴吧！不同的伙伴有不同的物种和稀有度（从普通到传说），还有独特的属性。"

5. 如果用户直接提问而不是领养伙伴，优先回答问题，但在回答末尾提一句蛋的事。

重要：必须输出上面的 show-widget 代码块，这是用户点击孵化的入口。
</assistant-buddy-welcome>`;
}

function buildProgressiveUpdateInstructions(): string {
  return `<assistant-memory-guidance>
## 记忆与文件更新

你可以在对话中随时更新 workspace 文件来记住重要信息：

### 身份文件（修改后必须告知用户）
- soul.md：你的风格和行为规则变化时更新
- user.md：用户画像变化时更新
- claude.md：执行规则变化时更新

### 记忆文件（可以静默更新）
- memory.md：追加稳定的事实和偏好（只追加，不覆写）
- memory/daily/{日期}.md：记录今天的工作和决策

### 更新判断标准
- 用户明确要求记住/修改某规则 → 立即更新
- 用户连续表达同一偏好 → 写入 user.md 或 soul.md
- 重要决策或经验总结 → 写入 memory.md
- 日常工作记录 → 写入 daily memory
- 不确定是否值得记录 → 先不写，多观察

### 禁止
- 不要在身份文件中存储敏感信息（密码、API key）
- 不要覆写 memory.md 已有内容（只追加）
- 不要在没有告知用户的情况下修改 soul/user/claude.md
</assistant-memory-guidance>`;
}
