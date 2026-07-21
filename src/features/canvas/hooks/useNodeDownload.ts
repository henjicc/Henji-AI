import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { saveDialog } from '@/platform/desktopApi';
import { createLogger } from '@/core/logging';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { getNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { resolveLocalAssetPath } from '@/features/assets/services/assetCollectionService';
import { saveImageSourceToDirectory, saveImageSourceToPath } from '@/commands/image';
import {
  downloadMediaFile,
  quickDownloadMediaFile,
  saveAudioFromUrl,
  saveVideoFromUrl,
} from '@/utils/save';
import {
  QUICK_DOWNLOAD_SETTING_SPECS,
  readLocalStorageSettings,
} from '@/hooks/useLocalStorageSetting';
import { UI_POPOVER_TRANSITION_MS } from '@/components/ui/motion';

const logger = createLogger('features.canvas.hooks.useNodeDownload');

interface DownloadMenuPosition {
  x: number;
  y: number;
}

interface ImageDownloadTarget {
  mediaType: 'image';
  source: string;
  suggestedFileName: string;
}

interface FileDownloadTarget {
  mediaType: 'video' | 'audio';
  source: string;
  suggestedFileName: string;
}

type NodeDownloadTarget = ImageDownloadTarget | FileDownloadTarget;
type DownloadDirectoryMode = 'quick' | 'preset';

export interface UseNodeDownloadResult {
  canDownload: boolean;
  downloadMenu: DownloadMenuPosition | null;
  isDownloadMenuVisible: boolean;
  downloadMenuRef: RefObject<HTMLDivElement>;
  closeDownloadMenu: () => void;
  handleDownloadClick: (event: MouseEvent<HTMLElement>) => void;
  handleDownloadSaveAs: () => Promise<void>;
  handleDownloadToPreset: (targetDir: string) => Promise<void>;
}

function getFileExtension(sourcePath: string): string {
  const cleanPath = sourcePath.split(/[?#]/, 1)[0];
  const match = cleanPath.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? '';
}

function resolveNodeDownloadTarget(node: CanvasNode): NodeDownloadTarget | null {
  const definition = getNodeDefinition(node.type);
  if (!definition.capabilities.toolbarDownload) {
    return null;
  }

  const output = definition.getOutputs?.(node.data)[0];
  if (definition.media?.kind === 'image') {
    const previewSource = typeof node.data.previewImageUrl === 'string'
      ? node.data.previewImageUrl
      : null;
    const source = output?.kind === 'image' ? output.url : previewSource;
    if (!source) {
      return null;
    }
    return {
      mediaType: 'image',
      source,
      suggestedFileName: `node-${node.id}.png`,
    };
  }

  if (!output?.url) {
    return null;
  }

  if (output.kind !== 'video' && output.kind !== 'audio') {
    return null;
  }

  const source = resolveLocalAssetPath(output.url)
    ?? (/^https?:\/\//i.test(output.url) ? output.url : null);
  if (!source) {
    return null;
  }

  const fallbackExtension = output.kind === 'video' ? 'mp4' : 'mp3';
  const extension = getFileExtension(source) || fallbackExtension;
  return {
    mediaType: output.kind,
    source,
    suggestedFileName: `node-${node.id}.${extension}`,
  };
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'cancelled';
}

async function resolveMediaFileSource(target: FileDownloadTarget): Promise<string> {
  if (!/^https?:\/\//i.test(target.source)) {
    return target.source;
  }
  const saved = target.mediaType === 'video'
    ? await saveVideoFromUrl(target.source)
    : await saveAudioFromUrl(target.source);
  return saved.fullPath;
}

export function useNodeDownload(
  node: CanvasNode,
  downloadPresetPaths: string[]
): UseNodeDownloadResult {
  const downloadTarget = useMemo(() => resolveNodeDownloadTarget(node), [node]);
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

  const handleDownloadSaveAs = useCallback(async (): Promise<void> => {
    if (!downloadTarget) {
      return;
    }

    try {
      logger.info('画布媒体另存为开始', {
        event: 'canvas.media_download.start',
        nodeId: node.id,
        mediaType: downloadTarget.mediaType,
        mode: 'save_as',
      });
      let savedPath: string;
      if (downloadTarget.mediaType === 'image') {
        const selectedPath = await saveDialog({ defaultPath: downloadTarget.suggestedFileName });
        if (!selectedPath || Array.isArray(selectedPath)) {
          return;
        }
        savedPath = await saveImageSourceToPath(downloadTarget.source, selectedPath);
      } else {
        const sourcePath = await resolveMediaFileSource(downloadTarget);
        savedPath = await downloadMediaFile(sourcePath, downloadTarget.suggestedFileName);
      }
      logger.info('画布媒体另存为完成', {
        event: 'canvas.media_download.completed',
        nodeId: node.id,
        mediaType: downloadTarget.mediaType,
        mode: 'save_as',
        savedPath,
      });
      closeDownloadMenu();
    } catch (error) {
      if (isCancelledError(error)) {
        return;
      }
      logger.error('画布媒体另存为失败', error, {
        event: 'canvas.media_download.failed',
        context: { nodeId: node.id, mediaType: downloadTarget.mediaType, mode: 'save_as' },
      });
    }
  }, [closeDownloadMenu, downloadTarget, node.id]);

  const handleDownloadToDirectory = useCallback(async (
    targetDir: string,
    mode: DownloadDirectoryMode
  ): Promise<void> => {
    if (!downloadTarget) {
      return;
    }

    try {
      logger.info('画布媒体下载到目录开始', {
        event: 'canvas.media_download.start',
        nodeId: node.id,
        mediaType: downloadTarget.mediaType,
        mode,
      });
      const savedPath = downloadTarget.mediaType === 'image'
        ? await saveImageSourceToDirectory(
          downloadTarget.source,
          targetDir,
          downloadTarget.suggestedFileName.replace(/\.png$/i, '')
        )
        : await quickDownloadMediaFile(
          await resolveMediaFileSource(downloadTarget),
          targetDir,
          downloadTarget.suggestedFileName
        );
      logger.info('画布媒体下载到目录完成', {
        event: 'canvas.media_download.completed',
        nodeId: node.id,
        mediaType: downloadTarget.mediaType,
        mode,
        savedPath,
      });
      closeDownloadMenu();
    } catch (error) {
      logger.error('画布媒体下载到目录失败', error, {
        event: 'canvas.media_download.failed',
        context: { nodeId: node.id, mediaType: downloadTarget.mediaType, mode },
      });
    }
  }, [closeDownloadMenu, downloadTarget, node.id]);

  const handleDownloadToPreset = useCallback(async (targetDir: string): Promise<void> => {
    await handleDownloadToDirectory(targetDir, 'preset');
  }, [handleDownloadToDirectory]);

  const handleDownloadClick = useCallback((event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    if (!downloadTarget) {
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
    downloadTarget,
    handleDownloadSaveAs,
    handleDownloadToDirectory,
  ]);

  return {
    canDownload: Boolean(downloadTarget),
    downloadMenu,
    isDownloadMenuVisible,
    downloadMenuRef,
    closeDownloadMenu,
    handleDownloadClick,
    handleDownloadSaveAs,
    handleDownloadToPreset,
  };
}
