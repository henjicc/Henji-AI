import { useCallback, useEffect, useRef, useState } from 'react';

import { persistImageSourceTracked } from '@/commands/image';
import { createLogger } from '@/core/logging';
import { cloneMaskDocument, hasPaintedMask } from '@/features/maskEditor/maskDocument';
import { exportMaskDocumentToPng } from '@/features/maskEditor/maskExport';
import type { MaskEditorDocument } from '@/features/maskEditor/types';
import { getPlatform } from '@/platform/runtime';

const logger = createLogger('features.canvas.local-redraw-workbench');
const AUTOSAVE_DELAY_MS = 180;
const AUTOSAVE_RETRY_DELAY_MS = 1000;

export type LocalRedrawAutosaveState =
  | { status: 'idle' | 'saving' | 'saved' }
  | { status: 'failed'; message: string };

interface AutosaveJob {
  revision: number;
  document: MaskEditorDocument;
}

interface UseLocalRedrawMaskAutosaveOptions {
  document: MaskEditorDocument;
  ready: boolean;
  onPersist: (result: { maskSource: string | null; document: MaskEditorDocument }) => void;
}

async function releaseAutosavePaths(
  filePaths: readonly string[],
  revision: number,
  reason: 'failed' | 'stale',
): Promise<void> {
  const ownedPaths = [...new Set(filePaths)];
  if (ownedPaths.length === 0) return;
  try {
    await getPlatform().image.releaseManagedGenerationMedia(ownedPaths);
  } catch (error) {
    logger.error('节点内遮罩自动保存资源释放失败', {
      event: 'canvas.local_redraw.inline_mask.autosave.release_failed',
      revision,
      reason,
      fileCount: ownedPaths.length,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

export function useLocalRedrawMaskAutosave({
  document,
  ready,
  onPersist,
}: UseLocalRedrawMaskAutosaveOptions): LocalRedrawAutosaveState {
  const [state, setState] = useState<LocalRedrawAutosaveState>({ status: 'idle' });
  const observedDocumentRef = useRef<MaskEditorDocument | null>(null);
  const mountedRef = useRef(false);
  const savingRef = useRef(false);
  const latestRevisionRef = useRef(0);
  const pendingRef = useRef<AutosaveJob | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPersistRef = useRef(onPersist);
  const drainRef = useRef<() => Promise<void>>(async () => undefined);
  onPersistRef.current = onPersist;

  const setMountedState = useCallback((next: LocalRedrawAutosaveState): void => {
    if (mountedRef.current) setState(next);
  }, []);

  const clearTimer = useCallback((): void => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const drain = useCallback(async (): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    clearTimer();
    try {
      while (pendingRef.current) {
        const job = pendingRef.current;
        pendingRef.current = null;
        const startedAt = performance.now();
        setMountedState({ status: 'saving' });
        logger.info('节点内遮罩自动保存开始', {
          event: 'canvas.local_redraw.inline_mask.autosave.start',
          revision: job.revision,
          strokeCount: job.document.strokes.length,
        });
        let createdFilePaths: string[] = [];
        try {
          let maskSource: string | null = null;
          if (hasPaintedMask(job.document)) {
            const persisted = await persistImageSourceTracked(exportMaskDocumentToPng(job.document));
            maskSource = persisted.imagePath;
            createdFilePaths = persisted.createdFilePaths;
          }
          if (!mountedRef.current || job.revision !== latestRevisionRef.current) {
            await releaseAutosavePaths(createdFilePaths, job.revision, 'stale');
            createdFilePaths = [];
            continue;
          }
          onPersistRef.current({
            maskSource,
            document: cloneMaskDocument(job.document),
          });
          // onPersist 返回即视为所有权已转移给节点。旧版仍可能被在途生成上下文引用，
          // 在 V3 资源仓库具备引用扫描前不能由 autosave 提前回收。
          createdFilePaths = [];
          setMountedState({ status: 'saved' });
          logger.info('节点内遮罩自动保存完成', {
            event: 'canvas.local_redraw.inline_mask.autosave.completed',
            revision: job.revision,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          await releaseAutosavePaths(createdFilePaths, job.revision, 'failed');
          const message = error instanceof Error ? error.message : String(error);
          if (mountedRef.current && job.revision === latestRevisionRef.current) {
            pendingRef.current = job;
            setMountedState({ status: 'failed', message });
          }
          logger.error('节点内遮罩自动保存失败', {
            event: 'canvas.local_redraw.inline_mask.autosave.failed',
            revision: job.revision,
            elapsedMs: Math.round(performance.now() - startedAt),
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          if (mountedRef.current && pendingRef.current) {
            timerRef.current = setTimeout(() => void drainRef.current(), AUTOSAVE_RETRY_DELAY_MS);
          }
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
    if (pendingRef.current && !timerRef.current && mountedRef.current) {
      timerRef.current = setTimeout(() => void drainRef.current(), AUTOSAVE_DELAY_MS);
    }
  }, [clearTimer, setMountedState]);
  drainRef.current = drain;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      pendingRef.current = null;
    };
  }, [clearTimer]);

  useEffect(() => {
    if (!ready) return;
    if (!observedDocumentRef.current) {
      observedDocumentRef.current = document;
      return;
    }
    if (observedDocumentRef.current === document) return;
    observedDocumentRef.current = document;
    latestRevisionRef.current += 1;
    pendingRef.current = {
      revision: latestRevisionRef.current,
      document: cloneMaskDocument(document),
    };
    setState({ status: 'saving' });
    clearTimer();
    timerRef.current = setTimeout(() => void drainRef.current(), AUTOSAVE_DELAY_MS);
  }, [clearTimer, document, ready]);

  return state;
}
