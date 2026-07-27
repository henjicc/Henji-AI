import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCopy, FolderOpen, ImagePlus, LibraryBig, Save } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit';
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
} from '@/components/ui';
import { useNotification } from '@/contexts/NotificationContext';
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary';
import { allowMediaRoot, basename, dirname, getPathForFile, openDialog, saveDialog } from '@/platform/desktopApi';
import {
  copyImageSourceToClipboard,
  persistImageSource,
  saveImageSourceToPath,
} from '@/commands/image';
import { isLikelyLocalImagePath, readFileAsDataUrl } from '@/services/imageSource';
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution';
import { ImageEditor } from '@/features/imageEdit/editor/ImageEditor';

const logger = createLogger('features.imageMark');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

interface ImageMarkSource {
  url: string;
  /** 用于另存为默认文件名 */
  name: string;
  sessionKey: number;
}

export interface ImageMarkToolProps {
  /** 返回工具箱。本工具自带命令带,返回按钮由它自己渲染,外层不再画标题带。 */
  onBack?: () => void;
}

/**
 * 工具箱独立形态:打开/粘贴/拖入图片 → 快速标记 → 复制/另存为。
 *
 * 骨架约定:整个视图只有一条命令带 —— 空态是"返回 + 标题"，有图时把
 * 返回/打开图片/文件名注入编辑器命令带左侧,不为它们单开一行。
 */
export function ImageMarkTool({ onBack }: ImageMarkToolProps = {}): JSX.Element {
  const { showNotification } = useNotification();
  const { addMedia, collecting } = useAddToAssetLibrary();
  const [source, setSource] = useState<ImageMarkSource | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const documentRef = useRef<ImageEditDocument>(createEmptyImageEditDocument());
  const sourceSequenceRef = useRef(0);

  const acceptSource = useCallback(async (url: string, name: string) => {
    documentRef.current = createEmptyImageEditDocument();
    // 打开/拖入的本地图片可能在媒体协议默认白名单之外,先授权其所在目录,
    // 否则 henji-media:// 会 403,编辑器会一直卡在"图片加载中"
    if (isLikelyLocalImagePath(url)) {
      try {
        await allowMediaRoot(await dirname(url));
      } catch (error) {
        logger.warn('image_mark.standalone.allow_root.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    sourceSequenceRef.current += 1;
    setSource({ url, name, sessionKey: sourceSequenceRef.current });
    logger.info('image_mark.standalone.open.completed', { name });
  }, []);

  const acceptFile = useCallback(async (file: File) => {
    const nativePath = getPathForFile(file);
    if (nativePath) {
      await acceptSource(nativePath, basename(nativePath));
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    await acceptSource(dataUrl, file.name || `image-${Date.now()}.png`);
  }, [acceptSource]);

  const handleOpenFile = useCallback(async () => {
    logger.debug('image_mark.standalone.open.start');
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) {
        return;
      }
      await acceptSource(path, basename(path));
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
    logger.debug('image_mark.standalone.export.start', { action });
    try {
      const dataUrl = await exportImageEditDocument(source.url, documentRef.current);
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
        logger.info('image_mark.standalone.save.completed');
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

  const backButton = onBack ? (
    <UiIconButton
      showBorder={false}
      appearance="hover-only"
      className="h-7 w-7"
      title="返回工具箱"
      aria-label="返回工具箱"
      onClick={onBack}
    >
      <ArrowLeft size={15} />
    </UiIconButton>
  ) : null;

  if (!source) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-dark bg-surface-dark px-2">
          {backButton}
          <span className={UI_TEXT_LABEL_CLASS}>图片编辑</span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
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
            <div className={UI_TEXT_BODY_CLASS}>拖入图片、Ctrl+V 粘贴，或</div>
            <UiButton variant="primary" size="sm" onClick={() => void handleOpenFile()}>
              <FolderOpen size={15} className="mr-1.5" />
              打开图片
            </UiButton>
            <div className={`leading-relaxed ${UI_TEXT_META_CLASS}`}>
              支持序号、框选、箭头、文字、画笔、马赛克标记,以及裁剪与旋转翻转
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <ImageEditor
        key={source.sessionKey}
        sourceImageUrl={source.url}
        onDocumentChange={(document) => {
          documentRef.current = document;
        }}
        toolbarLeading={backButton}
        toolbarActions={
          <>
            {/* 文件上下文与打开动作跟导出动作同侧,左侧只留返回,工具组才能真正居中 */}
            <span className={`max-w-[180px] truncate ${UI_TEXT_META_CLASS}`} title={source.name}>
              {source.name}
            </span>
            <UiIconButton
              type="button"
              showBorder={false}
              appearance="hover-only"
              className="h-8 w-8"
              title="打开图片"
              aria-label="打开图片"
              onClick={() => void handleOpenFile()}
            >
              <FolderOpen size={15} />
            </UiIconButton>
            <span className="mx-0.5 h-5 w-px bg-border-dark" />
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
