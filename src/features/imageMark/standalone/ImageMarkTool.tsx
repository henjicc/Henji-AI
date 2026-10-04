import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FilePlus2, FolderOpen, ImagePlus } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit';
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiLoading,
  UiPageHeader,
  UiRegion,
} from '@/components/ui';
import { readClipboardImage } from '@/commands/clipboard';
import { useNotification } from '@/contexts/NotificationContext';
import { allowMediaRoot, basename, dirname, getPathForFile, openDialog } from '@/platform/desktopApi';
import { isLikelyLocalImagePath, readFileAsDataUrl } from '@/services/imageSource';
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore';
import { BlankImageDialog } from './BlankImageDialog';
import { createBlankImageDataUrl, type BlankImageSpec } from './blankImage';
import { readDevelopmentLaunchOptions } from '@/core/development/developmentLaunch';
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
  /** 返回“工具”首页。本工具自带命令带,返回按钮由它自己渲染,外层不再画标题带。 */
  onBack?: () => void;
}

/**
 * 工具箱独立形态:打开/粘贴/拖入图片 → 快速标记 → 复制/另存为。
 *
 * 骨架约定:整个视图只有一条命令带 —— 空态是"返回 + 标题"，有图时把
 * 返回/打开图片/文件名注入编辑器命令带左侧,不为它们单开一行。
 */
export function ImageMarkTool({ onBack }: ImageMarkToolProps = {}): JSX.Element {
  const developmentLaunch = readDevelopmentLaunchOptions();
  const { showNotification } = useNotification();
  const [source, setSource] = useState<ImageMarkSource | null>(() => readImageMarkToolWorkspaceSourceV3());
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBlankDialogOpen, setIsBlankDialogOpen] = useState(false);
  const pendingHandoff = useImageEditorHandoffStore((state) => state.pending);
  const consumeHandoff = useImageEditorHandoffStore((state) => state.consume);
  const sourceSequenceRef = useRef(source?.sessionKey ?? 0);
  const acceptingHandoffRef = useRef<string | null>(null);
  const acceptedDevelopmentMediaRef = useRef(false);

  const acceptSource = useCallback(async (
    url: string,
    name: string,
    document: ImageEditDocument = createEmptyImageEditDocument(),
    dpi?: number,
    returnTo?: string
  ) => {
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
      ...(returnTo ? { returnTo } : {}),
    };
    setSource(nextSource);
    rememberImageMarkToolWorkspaceSourceV3(nextSource);
    logger.info('image_mark.standalone.open.completed', { name });
  }, []);

  const rememberV3Session = useCallback((
    sessionKey: number,
    session: NonNullable<ImageMarkSource['session']>,
  ): void => {
    rememberImageMarkToolWorkspaceSessionV3(sessionKey, session);
  }, []);

  useEffect(() => {
    if (!developmentLaunch.mediaPath || acceptedDevelopmentMediaRef.current) return;
    acceptedDevelopmentMediaRef.current = true;
    void acceptSource(
      developmentLaunch.mediaPath,
      basename(developmentLaunch.mediaPath)
    ).catch((error) => {
      logger.error('image_mark.development_launch.media.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [acceptSource, developmentLaunch.mediaPath]);

  useEffect(() => {
    if (!pendingHandoff || acceptingHandoffRef.current === pendingHandoff.sessionRef) return;
    acceptingHandoffRef.current = pendingHandoff.sessionRef;
    void acceptSource(
      pendingHandoff.sourceUrl,
      pendingHandoff.sourceName,
      pendingHandoff.document,
      undefined,
      pendingHandoff.sessionRef
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

  if (!source) {
    return (
      <>
        {/* 空态没有工作面，是一张普通页面：返回进标题左侧，不为它单画一条命令带 */}
        <div className="flex h-full flex-col overflow-y-auto bg-window p-6">
          <UiRegion maxWidthClassName="max-w-6xl" className="mx-auto w-full">
            <UiPageHeader title="图片编辑" onBack={onBack} backLabel="返回工具" />
          </UiRegion>
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <div
              className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-overlay border-2 border-dashed p-12 transition-colors ${
                isDragOver ? 'border-accent bg-accent-tint' : 'border-line bg-raised/40'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              <ImagePlus size={40} className="text-text2" />
              <div className={UI_TEXT_BODY_CLASS}>打开已有图片，或创建一张空白画布</div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <UiButton variant="primary" onClick={() => void handleOpenFile()}>
                  <FolderOpen size={15} className="mr-1.5" />
                  从文件打开
                </UiButton>
                <UiButton variant="secondary" onClick={() => setIsBlankDialogOpen(true)}>
                  <FilePlus2 size={15} className="mr-1.5" />
                  新建空白图片
                </UiButton>
                <UiButton variant="secondary" onClick={() => void handlePasteFromClipboard()}>
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
            videoEditReturn={source.returnTo}
            onSessionReferenceChange={(session) => {
              rememberV3Session(source.sessionKey, session);
            }}
            onBack={onBack}
            onOpenFile={handleOpenFile}
            onPasteFromClipboard={handlePasteFromClipboard}
            onCreateBlank={() => setIsBlankDialogOpen(true)}
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

export default ImageMarkTool;
