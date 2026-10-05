import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FilePlus2, FolderOpen, ImagePlus } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { createEmptyImageEditDocument, type ImageEditDocument } from '@/core/imageEdit';
import { UiLoading } from '@/components/ui';
import { ProjectLibraryPage, type ProjectLibraryLabels } from '@/components/ProjectLibraryPage';
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons';
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

/**
 * 图片编辑暂时没有项目列表（图片文档列表在 3.3 接入 .henjiimg 后提供），项目页只用到空态的新建提示。
 * 受管文档目录里混有画布节点、剪辑画面的文档，没有名称与归属，不能直接列给用户再独立编辑。
 */
const EMPTY_PAGE_LABELS: ProjectLibraryLabels = {
  createAction: '新建',
  count: (count) => `${count} 张图片`,
  searchPlaceholder: '搜索图片',
  noResults: '没有符合条件的图片',
  sortLabel: '排序',
  sortOptions: { updated: '最近编辑', created: '最近创建', name: '名称' },
  emptyTitle: '打开已有图片，或创建一张空白画布',
  emptyDescription: '也可以把图片拖到这里；支持序号、框选、弯曲箭头、文字、画笔、打码与裁剪。',
  cancel: '取消',
  card: { open: '打开', more: '更多' },
};

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

  const handleDropFiles = useCallback((files: File[]) => {
    const file = files.find((entry) =>
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

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    handleDropFiles(Array.from(event.dataTransfer.files));
  }, [handleDropFiles]);

  if (!source) {
    return (
      <>
        {/* 空态是五个模块共用的项目页：返回进标题左侧，新建来源平铺成按钮，可把图片拖进来 */}
        <ProjectLibraryPage
          title="图片编辑"
          onBack={onBack}
          backLabel="返回工具"
          items={[]}
          icon={ICON_TOOL_IMAGE_EDIT}
          emptyIcon={<ImagePlus size={40} strokeWidth={1.5} aria-hidden="true" />}
          labels={EMPTY_PAGE_LABELS}
          create={{
            kind: 'menu',
            options: [
              { id: 'open', label: '打开图片', icon: FolderOpen, onSelect: () => void handleOpenFile() },
              { id: 'blank', label: '新建空白图片', icon: FilePlus2, onSelect: () => setIsBlankDialogOpen(true) },
              { id: 'paste', label: '粘贴剪贴板图片', icon: ClipboardPaste, onSelect: () => void handlePasteFromClipboard() },
            ],
          }}
          onDropFiles={handleDropFiles}
          onOpen={() => undefined}
        />
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
