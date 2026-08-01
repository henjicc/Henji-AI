import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { openDialog } from '@/platform/desktopApi';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import {
  downloadCanvasMediaTargetsToDirectory,
  resolveNodeDownloadTargets,
  saveCanvasMediaTargetAs,
  type CanvasMediaDownloadSummary,
} from '@/features/canvas/application/canvasMediaDownload';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import {
  QUICK_DOWNLOAD_SETTING_SPECS,
  readLocalStorageSettings,
} from '@/hooks/useLocalStorageSetting';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

interface DownloadMenuPosition {
  x: number;
  y: number;
}

type DownloadDirectoryMode = 'quick' | 'preset';

export interface UseNodeDownloadResult {
  canDownload: boolean;
  downloadCount: number;
  downloadMenu: DownloadMenuPosition | null;
  isDownloadMenuVisible: boolean;
  downloadMenuRef: RefObject<HTMLDivElement>;
  closeDownloadMenu: () => void;
  handleDownloadClick: (event: MouseEvent<HTMLElement>) => void;
  handleDownloadSaveAs: () => Promise<void>;
  handleDownloadToPreset: (targetDir: string) => Promise<void>;
}

export function useNodeDownload(
  nodeOrNodes: CanvasNode | readonly CanvasNode[],
  downloadPresetPaths: string[]
): UseNodeDownloadResult {
  const { t } = useTranslation();
  const downloadTargets = useMemo(
    () => resolveNodeDownloadTargets(Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes]),
    [nodeOrNodes]
  );
  const [downloadMenu, setDownloadMenu] = useState<DownloadMenuPosition | null>(null);
  const [isDownloadMenuVisible, setIsDownloadMenuVisible] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const downloadMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeDownloadMenu = useCallback((): void => {
    setIsDownloadMenuVisible(false);
    if (downloadMenuCloseTimerRef.current) {
      clearTimeout(downloadMenuCloseTimerRef.current);
    }
    downloadMenuCloseTimerRef.current = setTimeout(() => {
      setDownloadMenu(null);
      downloadMenuCloseTimerRef.current = null;
    }, UI_POPOVER_TRANSITION_MS);
  }, []);

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const menuElement = downloadMenuRef.current;
      if (!menuElement || !menuElement.contains(event.target as Node)) {
        closeDownloadMenu();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [closeDownloadMenu, downloadMenu]);

  useEffect(() => {
    if (!downloadMenu) {
      return;
    }
    const frameId = requestAnimationFrame(() => setIsDownloadMenuVisible(true));
    return () => cancelAnimationFrame(frameId);
  }, [downloadMenu]);

  useEffect(() => () => {
    if (downloadMenuCloseTimerRef.current) {
      clearTimeout(downloadMenuCloseTimerRef.current);
    }
  }, []);

  const showBatchResult = useCallback((summary: CanvasMediaDownloadSummary): void => {
    if (summary.requestedCount <= 1) {
      return;
    }
    const failedCount = summary.failedNodeIds.length;
    canvasEventBus.publish('canvas/toast', {
      message: failedCount > 0
        ? t('nodeToolbar.batchDownloadPartial', {
            saved: summary.savedNodeIds.length,
            failed: failedCount,
          })
        : t('nodeToolbar.batchDownloadCompleted', { count: summary.savedNodeIds.length }),
      type: failedCount > 0 ? 'error' : 'success',
    });
  }, [t]);

  const showDownloadFailed = useCallback((): void => {
    canvasEventBus.publish('canvas/toast', {
      message: t('nodeToolbar.batchDownloadFailed'),
      type: 'error',
    });
  }, [t]);

  const handleDownloadSaveAs = useCallback(async (): Promise<void> => {
    if (downloadTargets.length === 0) return;

    try {
      if (downloadTargets.length === 1) {
        const savedPath = await saveCanvasMediaTargetAs(downloadTargets[0]);
        if (savedPath) closeDownloadMenu();
      } else {
        const selectedDir = await openDialog({ directory: true });
        if (!selectedDir || Array.isArray(selectedDir)) return;
        const summary = await downloadCanvasMediaTargetsToDirectory(
          downloadTargets,
          selectedDir,
          'folder'
        );
        showBatchResult(summary);
        closeDownloadMenu();
      }
    } catch {
      showDownloadFailed();
    }
  }, [closeDownloadMenu, downloadTargets, showBatchResult, showDownloadFailed]);

  const handleDownloadToDirectory = useCallback(async (
    targetDir: string,
    mode: DownloadDirectoryMode
  ): Promise<void> => {
    if (downloadTargets.length === 0) return;

    try {
      const summary = await downloadCanvasMediaTargetsToDirectory(downloadTargets, targetDir, mode);
      showBatchResult(summary);
      closeDownloadMenu();
    } catch {
      showDownloadFailed();
    }
  }, [closeDownloadMenu, downloadTargets, showBatchResult, showDownloadFailed]);

  const handleDownloadToPreset = useCallback(async (targetDir: string): Promise<void> => {
    await handleDownloadToDirectory(targetDir, 'preset');
  }, [handleDownloadToDirectory]);

  const handleDownloadClick = useCallback((event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    if (downloadTargets.length === 0) {
      return;
    }
    const quickDownloadSettings = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS);
    const quickDownloadPath = quickDownloadSettings.quickDownloadPath.trim();
    if (quickDownloadSettings.enableQuickDownload && quickDownloadPath) {
      void handleDownloadToDirectory(quickDownloadPath, 'quick');
      return;
    }
    if (downloadPresetPaths.length === 0) {
      void handleDownloadSaveAs();
      return;
    }
    setDownloadMenu({ x: event.clientX, y: event.clientY });
    setIsDownloadMenuVisible(false);
  }, [
    downloadPresetPaths.length,
    downloadTargets,
    handleDownloadSaveAs,
    handleDownloadToDirectory,
  ]);

  return {
    canDownload: downloadTargets.length > 0,
    downloadCount: downloadTargets.length,
    downloadMenu,
    isDownloadMenuVisible,
    downloadMenuRef,
    closeDownloadMenu,
    handleDownloadClick,
    handleDownloadSaveAs,
    handleDownloadToPreset,
  };
}
