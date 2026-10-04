import { createElement, useCallback, useMemo, type MouseEvent } from 'react';
import { Download, FolderOpen } from 'lucide-react';
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
import { useContextMenu, type MenuItem, type MenuPosition } from '@/hooks/useContextMenu';

type DownloadDirectoryMode = 'quick' | 'preset';

export interface UseNodeDownloadResult {
  canDownload: boolean;
  downloadCount: number;
  /** 下载位置菜单（另存为 + 预设目录），交给共享 `ContextMenu` 渲染（任务 5.9）。 */
  downloadMenu: { visible: boolean; position: MenuPosition; items: MenuItem[] };
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
  const menu = useContextMenu();
  const { showMenuAt, hideMenu: closeDownloadMenu } = menu;

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
    // 再点一次下载按钮收起菜单（按钮是菜单锚点，点它不算点外）
    if (menu.menuVisible) {
      closeDownloadMenu();
      return;
    }
    // 菜单贴着下载按钮弹出（右缘对齐），菜单项与其他菜单同一套外观
    const icon = (Icon: typeof Download) => createElement(Icon, { className: 'h-4 w-4' });
    showMenuAt(event.currentTarget, [
      {
        id: 'save-as',
        label: t(downloadTargets.length > 1 ? 'nodeToolbar.chooseDownloadFolder' : 'nodeToolbar.saveAs'),
        icon: icon(Download),
        divider: true,
        onClick: () => { void handleDownloadSaveAs(); },
      },
      ...downloadPresetPaths.map((path) => ({
        id: `preset:${path}`,
        label: path,
        title: path,
        icon: icon(FolderOpen),
        onClick: () => { void handleDownloadToPreset(path); },
      })),
    ]);
  }, [
    closeDownloadMenu,
    downloadPresetPaths,
    downloadTargets,
    handleDownloadSaveAs,
    handleDownloadToDirectory,
    handleDownloadToPreset,
    menu.menuVisible,
    showMenuAt,
    t,
  ]);

  return {
    canDownload: downloadTargets.length > 0,
    downloadCount: downloadTargets.length,
    downloadMenu: { visible: menu.menuVisible, position: menu.menuPosition, items: menu.menuItems },
    closeDownloadMenu,
    handleDownloadClick,
    handleDownloadSaveAs,
    handleDownloadToPreset,
  };
}
