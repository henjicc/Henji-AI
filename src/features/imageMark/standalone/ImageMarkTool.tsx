import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCopy, ClipboardPaste, FilePlus2, FolderOpen, ImagePlus, Save } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit';
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiIconButton,
  UiLoading,
  UiPageHeader,
  UiRegion,
} from '@/components/ui';
import { readClipboardImage } from '@/commands/clipboard';
import { ICON_ASSET_LIBRARY } from '@/core/theme/icons';
import { useNotification } from '@/contexts/NotificationContext';
import { useAddToAssetLibrary } from '@/features/assets/hooks/useAddToAssetLibrary';
import { allowMediaRoot, basename, dirname, getPathForFile, openDialog, saveDialog } from '@/platform/desktopApi';
import {
  copyImageSourceToClipboard,
  persistImageSource,
  saveImageSourceToPath,
} from '@/commands/image';
import { isLikelyLocalImagePath, readFileAsDataUrl } from '@/services/imageSource';
import { isImageEditorV3Enabled } from '@/platform/runtime';
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution';
import { ImageEditor } from '@/features/imageEdit/editor/ImageEditor';
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore';
import { BlankImageDialog } from './BlankImageDialog';
import { applyPngDpi, createBlankImageDataUrl, type BlankImageSpec } from './blankImage';
import { ImageMarkSourceMenu } from './ImageMarkSourceMenu';
import {
  readImageMarkToolWorkspaceSourceV3,
  rememberImageMarkToolWorkspaceSessionV3,
  rememberImageMarkToolWorkspaceSourceV3,
  type ImageMarkToolWorkspaceSourceV3,
} from './imageMarkToolWorkspaceV3';

const ImageMarkToolV3Host = lazy(async () => {
  const module = await import('./ImageMarkToolV3Host');
  return { default: module.ImageMarkToolV3Host };
});

const logger = createLogger('features.imageMark');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

type ImageMarkSource = ImageMarkToolWorkspaceSourceV3;

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
  const [source, setSource] = useState<ImageMarkSource | null>(() => (
    isImageEditorV3Enabled() ? readImageMarkToolWorkspaceSourceV3() : null
  ));
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBlankDialogOpen, setIsBlankDialogOpen] = useState(false);
  const [legacyFallbackSessionKey, setLegacyFallbackSessionKey] = useState<number | null>(null);
  const pendingHandoff = useImageEditorHandoffStore((state) => state.pending);
  const consumeHandoff = useImageEditorHandoffStore((state) => state.consume);
  const documentRef = useRef<ImageEditDocument>(createEmptyImageEditDocument());
  const sourceSequenceRef = useRef(source?.sessionKey ?? 0);
  const acceptingHandoffRef = useRef<string | null>(null);

  const acceptSource = useCallback(async (
    url: string,
    name: string,
    document: ImageEditDocument = createEmptyImageEditDocument(),
    dpi?: number
  ) => {
    documentRef.current = document;
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
    const nextSource: ImageMarkSource = {
      url,
      name,
      sessionKey: sourceSequenceRef.current,
      initialDocument: document,
      ...(dpi ? { dpi } : {}),
    };
    setSource(nextSource);
    if (isImageEditorV3Enabled()) rememberImageMarkToolWorkspaceSourceV3(nextSource);
    logger.info('image_mark.standalone.open.completed', { name });
  }, []);

  const rememberV3Session = useCallback((
    sessionKey: number,
    session: NonNullable<ImageMarkSource['session']>,
  ): void => {
    rememberImageMarkToolWorkspaceSessionV3(sessionKey, session);
  }, []);

  useEffect(() => {
    if (!pendingHandoff || acceptingHandoffRef.current === pendingHandoff.sessionRef) return;
    acceptingHandoffRef.current = pendingHandoff.sessionRef;
    void acceptSource(
      pendingHandoff.sourceUrl,
      pendingHandoff.sourceName,
      pendingHandoff.document
    )
      .then(() => consumeHandoff(pendingHandoff.sessionRef))
      .catch((error) => {
        logger.error('image_mark.standalone.handoff.failed', {
          sessionRef: pendingHandoff.sessionRef,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (acceptingHandoffRef.current === pendingHandoff.sessionRef) {
          acceptingHandoffRef.current = null;
        }
      });
  }, [acceptSource, consumeHandoff, pendingHandoff]);

  const acceptFile = useCallback(async (file: File) => {
    const nativePath = getPathForFile(file);
    if (nativePath) {
      await acceptSource(nativePath, basename(nativePath));
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    await acceptSource(dataUrl, file.name || `image-${Date.now()}.png`);
  }, [acceptSource]);

  const handlePasteFromClipboard = useCallback(async () => {
    const image = await readClipboardImage();
    if (!image) {
      showNotification('剪贴板里没有图片', 'error');
      return;
    }
    await acceptSource(image.dataUrl, image.name);
  }, [acceptSource, showNotification]);

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

  const handleCreateBlank = useCallback((spec: BlankImageSpec) => {
    logger.debug('image_mark.blank.create.start', {
      width: spec.width,
      height: spec.height,
      dpi: spec.dpi,
    });
    try {
      const dataUrl = createBlankImageDataUrl(spec);
      void acceptSource(
        dataUrl,
        `空白图片-${spec.width}x${spec.height}.png`,
        createEmptyImageEditDocument(),
        spec.dpi
      ).then(() => {
        setIsBlankDialogOpen(false);
        logger.info('image_mark.blank.create.completed', {
          width: spec.width,
          height: spec.height,
          dpi: spec.dpi,
        });
      }).catch((error) => {
        logger.error('image_mark.blank.create.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        showNotification('创建空白图片失败', 'error');
      });
    } catch (error) {
      logger.error('image_mark.blank.create.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      showNotification(error instanceof Error ? error.message : '创建空白图片失败', 'error');
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
      const exportedDataUrl = await exportImageEditDocument(source.url, documentRef.current);
      const dataUrl = source.dpi ? applyPngDpi(exportedDataUrl, source.dpi) : exportedDataUrl;
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
      <>
        {/* 空态没有工作面，是一张普通页面：返回进标题左侧，不为它单画一条命令带 */}
        <div className="flex h-full flex-col overflow-y-auto bg-app p-6">
          <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto w-full">
            <UiPageHeader title="图片编辑" onBack={onBack} backLabel="返回工具箱" />
          </UiRegion>
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
              <div className={UI_TEXT_BODY_CLASS}>打开已有图片，或创建一张空白画布</div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <UiButton variant="primary" size="sm" onClick={() => void handleOpenFile()}>
                  <FolderOpen size={15} className="mr-1.5" />
                  从文件打开
                </UiButton>
                <UiButton variant="ghost" size="sm" onClick={() => setIsBlankDialogOpen(true)}>
                  <FilePlus2 size={15} className="mr-1.5" />
                  新建空白图片
                </UiButton>
                <UiButton variant="ghost" size="sm" onClick={() => void handlePasteFromClipboard()}>
                  <ClipboardPaste size={15} className="mr-1.5" />
                  粘贴剪贴板图片
                </UiButton>
              </div>
              <div className={`leading-relaxed ${UI_TEXT_META_CLASS}`}>
                也可以把图片拖到这里；支持序号、框选、弯曲箭头、文字、画笔、打码与裁剪
              </div>
            </div>
          </div>
        </div>
        <BlankImageDialog
          isOpen={isBlankDialogOpen}
          onClose={() => setIsBlankDialogOpen(false)}
          onCreate={handleCreateBlank}
        />
      </>
    );
  }

  if (isImageEditorV3Enabled() && legacyFallbackSessionKey !== source.sessionKey) {
    return (
      <>
        <div
          className="flex h-full flex-col"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <Suspense fallback={<UiLoading message="正在打开图片编辑器…" className="h-full" />}>
            <ImageMarkToolV3Host
              key={source.sessionKey}
              sourceImageUrl={source.url}
              sourceName={source.name}
              sourceSessionKey={source.sessionKey}
              initialDocument={source.initialDocument}
              initialSession={source.session}
              onSessionReferenceChange={(session) => {
                rememberV3Session(source.sessionKey, session);
              }}
              onBack={onBack}
              onOpenFile={handleOpenFile}
              onPasteFromClipboard={handlePasteFromClipboard}
              onCreateBlank={() => setIsBlankDialogOpen(true)}
              onFallback={() => setLegacyFallbackSessionKey(source.sessionKey)}
            />
          </Suspense>
        </div>
        <BlankImageDialog
          isOpen={isBlankDialogOpen}
          onClose={() => setIsBlankDialogOpen(false)}
          onCreate={handleCreateBlank}
        />
      </>
    );
  }

  return (
    <>
      <div
        className="flex h-full flex-col"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <ImageEditor
        key={source.sessionKey}
        sourceImageUrl={source.url}
        initialDocument={source.initialDocument}
        onDocumentChange={(document) => {
          documentRef.current = document;
        }}
        toolbarLeading={backButton}
        toolbarActions={
          <>
            {/* 打开动作与导出动作同侧,左侧只留返回,工具组才能真正居中 */}
            <ImageMarkSourceMenu
              disabled={isBusy}
              onOpenFile={() => void handleOpenFile()}
              onPasteFromClipboard={() => void handlePasteFromClipboard()}
              onCreateBlank={() => setIsBlankDialogOpen(true)}
            />
            {/* 「打开」与右侧三个导出动作都是动作，只是方向相反，用间距分组即可。
                分隔线留给交互语义根本不同的两侧（如工具 vs 动作），一条带上最多一条。 */}
            <UiButton variant="ghost" size="sm" className="ml-2" disabled={isBusy} onClick={() => void runExport('copy')}>
              <ClipboardCopy size={15} className="mr-1.5" />
              复制
            </UiButton>
            <UiButton
              variant="ghost"
              size="sm"
              disabled={isBusy || collecting}
              onClick={() => void runExport('collect')}
            >
              <ICON_ASSET_LIBRARY size={15} className="mr-1.5" />
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
      <BlankImageDialog
        isOpen={isBlankDialogOpen}
        onClose={() => setIsBlankDialogOpen(false)}
        onCreate={handleCreateBlank}
      />
    </>
  );
}

export default ImageMarkTool;
