'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { CaretRight, NotePencil, Eye, Image } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

/**
 * Per-row metadata produced by MessageItem when an assistant turn writes or
 * edits files. `path` is the full filesystem path; `name` is the basename
 * shown in the collapsed list.
 */
export type DiffFile = { path: string; name: string };

export interface DiffSummaryProps {
  files: DiffFile[];
  /**
   * Called when the user clicks "Preview" on a row whose extension is
   * previewable. When omitted, the preview button is not rendered (so
   * older callers of DiffSummary see no visual change).
   */
  onPreview?: (file: DiffFile) => void;
  /**
   * Called when the user clicks "Export long screenshot" on a row whose
   * extension renders to a shareable page (HTML / JSX / TSX). Phase 3
   * wires this to the artifact:export-long-shot IPC; leave undefined
   * for now to hide the button.
   */
  onExportLongShot?: (file: DiffFile) => void;
}

/**
 * Per-extension capability gates. These are the two sets defined in
 * docs/research/phase-0-pocs/0.6-diffsummary-design.md. Changing the sets
 * is a product decision — keep them in sync with PreviewPanel's supported
 * kinds (src/components/layout/panels/PreviewPanel.tsx RENDERABLE_EXTENSIONS)
 * when adding new preview surfaces.
 */
const PREVIEWABLE = new Set(['.md', '.mdx', '.html', '.htm', '.jsx', '.tsx']);
const LONGSHOT = new Set(['.html', '.htm', '.jsx', '.tsx']);

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/**
 * Summary of files written or edited by the last assistant turn.
 *
 * Expanded, each row shows the file basename plus optional action buttons.
 * The buttons only render when both (a) the caller passes the matching
 * callback, and (b) the file's extension is in the capability set — so a
 * `.ts` file edit still produces a plain diff row with no Preview button,
 * and an unwired DiffSummary (no callbacks) looks exactly like it did
 * before Phase 2.3.
 */
export function DiffSummary({ files, onPreview, onExportLongShot }: DiffSummaryProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <CaretRight
          size={10}
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')}
        />
        <span>
          Modified {files.length} file{files.length > 1 ? 's' : ''}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ml-3 mt-0.5 space-y-0.5">
              {files.map((f) => {
                const ext = getExt(f.name);
                const showPreview = !!onPreview && PREVIEWABLE.has(ext);
                const showLongShot = !!onExportLongShot && LONGSHOT.has(ext);
                return (
                  <div
                    key={f.path}
                    className="group flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
                  >
                    <NotePencil size={10} className="shrink-0" />
                    <span className="truncate" title={f.path}>
                      {f.name}
                    </span>
                    {(showPreview || showLongShot) && (
                      <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {showPreview && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="h-5 w-5 p-0"
                            onClick={() => onPreview?.(f)}
                            title="Preview"
                          >
                            <Eye size={10} />
                            <span className="sr-only">Preview</span>
                          </Button>
                        )}
                        {showLongShot && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="h-5 w-5 p-0"
                            onClick={() => onExportLongShot?.(f)}
                            title="Export long screenshot"
                          >
                            <Image size={10} />
                            <span className="sr-only">Export long screenshot</span>
                          </Button>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
