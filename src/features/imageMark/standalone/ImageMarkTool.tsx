import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCopy, FolderOpen, ImagePlus, LibraryBig, Save } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { UiButton } from '@/components/ui';
import { useNotification } from '@/contexts/NotificationContext';
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary';
import { basename, getPathForFile, openDialog, saveDialog } from '@/platform/desktopApi';
import {
  copyImageSourceToClipboard,
  persistImageSource,
  saveImageSourceToPath,
} from '@/commands/image';
import { readFileAsDataUrl } from '@/services/imageSource';
import { createEmptyMarkDoc, type ImageMarkDoc } from '../domain/types';
import { exportMarkedImage } from '../render/exportMarkedImage';
import { MarkEditor } from '../editor/MarkEditor';

const logger = createLogger('features.imageMark');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

interface ImageMarkSource {
  url: string;
  /** 用于另存为默认文件名 */
  name: string;
}

/**
 * 工具箱独立形态:打开/粘贴/拖入图片 → 快速标记 → 复制/另存为。
 */
export function ImageMarkTool(): JSX.Element {
  const { showNotification } = useNotification();
  const { addMedia, collecting } = useAddToAssetLibrary();
  const [source, setSource] = useState<ImageMarkSource | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const docRef = useRef<ImageMarkDoc>(createEmptyMarkDoc());

  const acceptSource = useCallback((url: string, name: string) => {
    docRef.current = createEmptyMarkDoc();
    setSource({ url, name });
    logger.info('image_mark.standalone.open.completed', { name });
  }, []);

  const acceptFile = useCallback(async (file: File) => {
    const nativePath = getPathForFile(file);
    if (nativePath) {
      acceptSource(nativePath, basename(nativePath));
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    acceptSource(dataUrl, file.name || `image-${Date.now()}.png`);
  }, [acceptSource]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) {
        return;
      }
      acceptSource(path, basename(path));
    } catch (error) {
      logger.error('image_mark.standalone.open.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      showNotification('打开图片失败', 'error');
    }
  }, [acceptSource, showNotification]);

  // 粘贴图片(截图或复制的图片文件)
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) {
        return;
      }
      const imageFile = Array.from(files).find((file) => file.type.startsWith('image/'));
      if (!imageFile) {
        return;
      }
      event.preventDefault();
      void acceptFile(imageFile).catch((error) => {
        logger.error('image_mark.standalone.paste.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        showNotification('粘贴图片失败', 'error');
      });
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [acceptFile, showNotification]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = Array.from(event.dataTransfer.files).find((entry) =>
      entry.type.startsWith('image/') ||
      IMAGE_EXTENSIONS.some((extension) => entry.name.toLowerCase().endsWith(`.${extension}`))
    );
    if (!file) {
      return;
    }
    void acceptFile(file).catch((error) => {
      logger.error('image_mark.standalone.drop.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      showNotification('读取图片失败', 'error');
    });
  }, [acceptFile, showNotification]);

  const runExport = useCallback(async (action: 'copy' | 'save' | 'collect') => {
    if (!source || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const dataUrl = await exportMarkedImage(source.url, docRef.current);
      if (action === 'copy') {
        await copyImageSourceToClipboard(dataUrl);
        logger.info('image_mark.standalone.copy.completed', { name: source.name });
        showNotification('已复制到剪贴板');
      } else if (action === 'save') {
        const defaultName = source.name.replace(/\.[^.]+$/, '') || 'image';
        const targetPath = await saveDialog({
          defaultPath: `${defaultName}-标记.png`,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        });
        if (!targetPath) {
          return;
        }
        await saveImageSourceToPath(dataUrl, targetPath);
        logger.info('image_mark.standalone.save.completed', { targetPath });
        showNotification('已保存');
      } else {
        const filePath = await persistImageSource(dataUrl);
        await addMedia({
          filePath,
          mediaType: 'image',
          source: 'imported',
          displayName: source.name,
        });
        logger.info('image_mark.standalone.collect.completed', { name: source.name });
        showNotification('已加入资产库');
      }
    } catch (error) {
      logger.error('image_mark.standalone.export.failed', {
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      showNotification(
        action === 'copy' ? '复制失败' : action === 'save' ? '保存失败' : '加入资产库失败',
        'error'
      );
    } finally {
      setIsBusy(false);
    }
  }, [addMedia, isBusy, showNotification, source]);

  if (!source) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
            isDragOver ? 'border-accent bg-accent/10' : 'border-border-dark bg-surface-dark/40'
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <ImagePlus size={40} className="text-text-muted" />
          <div className="text-sm text-text-dark">拖入图片、Ctrl+V 粘贴,或</div>
          <UiButton variant="primary" size="sm" onClick={() => void handleOpenFile()}>
            <FolderOpen size={15} className="mr-1.5" />
            打开图片
          </UiButton>
          <div className="text-xs leading-relaxed text-text-muted">
            支持序号、框选、箭头、文字、画笔、马赛克标记,以及裁剪与旋转翻转
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-3 p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex shrink-0 items-center gap-2">
        <UiButton variant="ghost" size="sm" onClick={() => void handleOpenFile()}>
          <FolderOpen size={15} className="mr-1.5" />
          打开图片
        </UiButton>
        <span className="max-w-[320px] truncate text-xs text-text-muted" title={source.name}>
          {source.name}
        </span>
      </div>

      <MarkEditor
        key={source.url}
        sourceImageUrl={source.url}
        onDocChange={(doc) => {
          docRef.current = doc;
        }}
        toolbarActions={
          <>
            <UiButton variant="ghost" size="sm" disabled={isBusy} onClick={() => void runExport('copy')}>
              <ClipboardCopy size={15} className="mr-1.5" />
              复制
            </UiButton>
            <UiButton
              variant="ghost"
              size="sm"
              disabled={isBusy || collecting}
              onClick={() => void runExport('collect')}
            >
              <LibraryBig size={15} className="mr-1.5" />
              加入资产库
            </UiButton>
            <UiButton variant="primary" size="sm" disabled={isBusy} onClick={() => void runExport('save')}>
              <Save size={15} className="mr-1.5" />
              {isBusy ? '处理中…' : '另存为…'}
            </UiButton>
          </>
        }
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default ImageMarkTool;
