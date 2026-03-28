# CLI Tools — 产品思考

> 技术实现见 [docs/handover/cli-tools.md](../handover/cli-tools.md)

## 解决了什么问题

AI 编程助手（Claude Code、Cursor 等）大量依赖 CLI 工具完成实际任务——ffmpeg 处理视频、jq 处理 JSON、yt-dlp 下载内容。但存在一个断裂：**用户知道想做什么，模型知道怎么做，中间却卡在"工具装没装、装在哪、怎么装"上。**

具体痛点：
1. 用户装了工具但模型不知道（没注入到上下文）
2. 模型推荐了工具但用户不会装（跳出聊天去搜索安装教程）
3. 装完了还要配置认证（Stripe login、ElevenLabs API key），又是一轮跳出
4. AI 生成的工具简介关掉就没了，下次还要重新生成
5. 工具版本过期了没人提醒

## 为什么用 MCP 而不是纯 UI

最初的设计是纯 UI 管理页面——浏览、安装、查看详情。这对"已知工具"有效，但无法处理"用户告诉模型一个新工具名，模型帮他装好并注册"的场景。

Karpathy 在 [Vibe coding: MenuGen](https://karpathy.bearblog.dev/vibe-coding-menugen/) 里精确描述了这个问题：

> "Your service could have a CLI tool. The backend could be configured with curl commands. The docs could be Markdown. All of these are ergonomically friendlier for an LLM. Don't ask a developer to visit, look, or click. Instruct and empower their LLM."

**MCP 让工具管理成为对话的一部分**，而不是一个需要跳转的独立页面。用户说"帮我装 stripe"，模型调 MCP install → 安装 → 检测到 needs_auth → 引导用户跑 `stripe login` → 生成简介 → 注册到库，全在一个对话里完成。

但 UI 页面仍然保留——用于浏览已有工具、批量生成简介、快速发起"尝试使用"。**MCP 是操作通道，UI 是管理视图**，两者互补。

## 设计决策

### 关键词触发 vs 常驻注入

早期版本把完整工具列表注入到每次对话的 system prompt 里。问题：
- 10 个 catalog 工具 + 20 个 extra 工具，占几百 token
- 绝大多数对话不涉及 CLI 工具管理
- 列表会随工具增多线性增长

改为**关键词触发**：只在用户消息匹配 install/安装/更新 等关键词时才挂载 MCP server + 注入能力提示。模型需要工具列表时调 `list` 工具按需获取。

**代价**：用户说了很偏门的表达可能触发不了。**缓解**：持续扩宽正则，覆盖中英文自然说法。

### install 需要权限确认，list/add/remove 不需要

参考 [Building CLIs for agents](https://x.com/ericzakariasson/status/2036762680401223946) 的原则：

> "Destructive actions need --dry-run. Safe operations should just work."

install 和 update 执行 shell 命令、修改系统状态 → 需确认。list/add/remove/check_updates 是只读或可逆操作 → 自动批准。

### 简介由模型自身生成而不是调 API

MCP install 完成后，模型已经在对话中。让它自己生成简介（利用自身知识），然后通过 `add` 工具的 description 参数保存。省去一次 AI API 调用，且生成质量更高（模型有完整对话上下文）。

### 结构化简介对齐 catalog

最初 AI 简介只是一段话。用户反馈"跟官方推荐工具的详情差太多"。升级为结构化格式（intro / useCases / guideSteps / examplePrompts），与 catalog 工具完全对齐。详情弹窗统一渲染，用户体验一致。

## 外部趋势

### CLI 正在成为 AI Agent 的标准接口

观察到的趋势：
- **ElevenLabs** 专门为"让编码代理管理语音代理"设计了 CLI
- **Stripe Projects CLI** 提供 `llm-context` 命令生成 LLM 上下文文件，`--no-interactive` / `--json` 全套非交互 flag
- **网易云音乐 CLI** 直接内置 Claude Code skill 和 OpenClaw 集成
- **Eric Zakariasson** 的 "Building CLIs for agents" 文章总结了 agent-friendly CLI 的设计原则

共同点：CLI 工具不再只是给人类用的，而是 AI Agent 的操作接口。设计原则从"交互式体验"转向"非交互式、结构化输出、幂等、可管道化"。

### 环境变量/凭证管理是核心痛点

Karpathy 在 MenuGen 文章里花了 1 小时调试 `.env.local` 没同步到 Vercel。Stripe Projects CLI 的核心卖点就是统一凭证管理 + 自动 `.env` 同步。

我们的 `setupType: 'needs_auth'` + install 后自动引导认证是这个方向的第一步，但还不够——未来可以做：
- 检测工具的认证状态（`stripe status`、`elevenlabs agents status`）
- 统一管理 CLI 工具的 API key / token
- 在对话中自动检测"认证过期"并引导重新认证

### 安装按钮从直接执行到对话式

最初安装按钮直接通过 SSE 在服务端执行安装命令。这有三个问题：
1. **权限问题无法处理** — `npm install -g` 在 macOS 上经常遇到 EACCES，用户只看到红色错误
2. **认证引导断层** — 安装完了用户不知道下一步要 `stripe login` 还是 `gws auth setup`
3. **前置依赖遗漏** — 有些工具需要先装 mpv、配置 Skills 等，SSE 流程不知道

改成跳转聊天后，AI 可以 sudo 重试、从 `--help` 判断认证步骤、处理平台差异。但过程中犯了一个错误：把 `guideSteps`（给人看的文档）直接塞进 AI 的执行指令里，导致 `elevenlabs init` 在错误目录写文件、`brew install mpv` 在 Windows 执行。

最终方案：`postInstallCommands` 只放 AI 靠 `--help` 发现不了的命令（如 Skills 安装），认证引导只给一个 hint 让 AI 自己判断。文档和指令分开——`guideSteps` 给人看，`postInstallCommands` 给 AI 执行。

### Skills 安装的颗粒度问题

飞书 CLI 有 19 个 Skills，全装没问题。但 Google Workspace CLI 有 100+ 个 Skills，全装太暴力。改成让 AI 先查看列表，结合用户实际需求推荐装哪些，询问确认后再装。这个决策体现了一个原则：**AI 应该像顾问一样推荐，而不是像脚本一样全执行。**

## 已知局限

1. **版本更新检测依赖包管理器** — `brew outdated` / `npm outdated` 只能检测通过对应包管理器安装的工具。手动编译安装的工具无法检测更新。
2. **关键词触发有盲区** — 虽然正则持续扩宽，但总有覆盖不到的自然语言表达。
3. **install 执行任意 shell 命令** — 虽然需要用户确认，但模型可能生成不安全的命令。未来可以加白名单前缀校验。
4. **简介质量取决于模型** — MCP 流程里简介由模型自身生成，质量受模型能力和上下文限制。批量生成简介走 describe API 有结构化 prompt 保障质量。

## 未来方向

- **工具认证状态检测** — 在工具卡片上显示"已认证" / "需认证"状态
- **工具使用统计** — 追踪哪些工具被模型调用最多，优化推荐排序
- **社区工具市场** — 用户分享自己发现的好用 CLI 工具 + 安装配置
- **`--help` 注入** — 用户选择使用某个工具时，自动执行 `tool --help` 注入对话，避免模型用过时参数

## 更远的想法

### CLI 是 AI 时代的 API

REST API 是给程序调的，GUI 是给人看的，CLI 是两者之间的中间态——人能直接用，程序也能调。这个特性在 AI Agent 的语境下突然变得极其重要。

过去十年 SaaS 的标准交付方式是 Web Dashboard + REST API + SDK。现在正在出现第四种：**Agent-friendly CLI**。ElevenLabs、Stripe、网易云音乐都在往这个方向走。不是因为 CLI 更酷，而是因为 LLM 天然就是文本输入、文本输出的系统——CLI 的界面范式和 LLM 的能力范式完美重合。

我们做的事情本质上是在桌面 GUI 和 CLI 生态之间搭了一座桥。用户在 GUI 里说自然语言，模型翻译成 CLI 命令，结果再翻译回自然语言。这个循环越顺滑，用户能做的事情就越多——不需要学 ffmpeg 的参数，不需要记 jq 的语法，不需要知道 yt-dlp 怎么选格式。

### 工具的发现问题

我们现在有 catalog（人工策划）+ extra（自动检测）+ custom（用户添加/AI安装）三层。但这里有一个更根本的问题：**用户怎么知道自己需要一个工具？**

大多数情况下用户不会主动去"工具商店"逛。真正的触发点是对话中的需求——"帮我把这个视频压缩一下"，然后模型发现 ffmpeg 没装。理想的流程是：模型检测到能力缺口 → 推荐工具 → 用户同意 → 安装 → 继续任务，全程不离开对话。

我们的 MCP install 已经能做到后半段了。缺的是"模型主动发现能力缺口"这一步——这需要模型在执行任务前先 check 依赖。也许未来可以在 system prompt 里加一句："如果你需要调用的 CLI 工具不确定是否可用，先调 codepilot_cli_tools_list 确认。"

### "装机清单"的平台化

每个开发者换一台新电脑都要重新配环境。Homebrew Bundle（`brew bundle dump`）解决了一部分，但只覆盖 brew 生态。我们已经有了跨包管理器的工具注册数据（brew/npm/pipx/cargo/apt），理论上可以做"工具环境导出 → 在新机器上一键恢复"。

更有意思的方向是：**按工作流推荐工具组合**。做视频创作需要 ffmpeg + yt-dlp + ImageMagick；做 Web 开发需要 node + docker + stripe；做数据分析需要 python + jq + sqlite3。这些组合关系现在靠经验传递，未来可以变成可分享的"工具包"。

### 信任和安全的边界

MCP install 执行任意 shell 命令，靠权限弹窗让用户确认。但说实话，大多数用户看到"brew install ffmpeg"会直接点确认——他们信任的不是命令本身，而是模型的判断。

这意味着模型的安全性直接等于系统的安全性。如果模型被 prompt injection 诱导生成恶意安装命令，权限弹窗形同虚设。长远来看，可能需要：
- 安装命令白名单（只允许已知安全的包管理器 + 已知安全的包名）
- 安装前自动检查包的来源和信誉
- 社区维护的"安全包列表"

这不只是我们的问题，是整个 AI Agent 生态都会面临的挑战：**Agent 的行动权限应该基于意图而不是形式**。用户说"帮我装 ffmpeg"是安全的意图，但实现它的 shell 命令可能被劫持。怎么在保持灵活性的同时确保安全，是一个值得持续思考的问题。
