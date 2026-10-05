import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FilePlus2, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createLogger } from '@/core/logging';
import type { ImageEditDocument } from '@/core/imageEdit';
import type { DocumentSummary, DocumentTarget } from '@/core/documents/types';
import { AlertDialog, UiLoading } from '@/components/ui';
import { DocumentLibraryPage } from '@/features/documents/DocumentLibraryPage';
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons';
import { readClipboardImage } from '@/commands/clipboard';
import { useNotification } from '@/contexts/NotificationContext';
import { allowMediaRoot, dirname, getPathForFile, openDialog } from '@/platform/desktopApi';
import { isLikelyLocalImagePath, readFileAsDataUrl } from '@/services/imageSource';
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore';
import {
  findOpenImageDocument,
  leaveImageDocument,
  openImageDocument,
  saveImageDocument,
  saveImageDocumentAs,
  type OpenImageDocument,
} from '@/features/imageEdit/documents/imageDocumentRuntime';
import type {
  ImageDocumentRecoveryChoice,
  ImageDocumentRecoveryInfo,
} from '@/features/imageEdit/documents/imageDocumentPersistence';
import {
  getImageDocumentWorkspace,
  setCurrentImageDocument,
  takePendingImageDocument,
  useImageDocumentWorkspace,
} from '@/features/imageEdit/documents/imageDocumentWorkspace';
import { BlankImageDialog } from './BlankImageDialog';
import { createBlankImageDataUrl, type BlankImageSpec } from './blankImage';
import { createImageDocumentFromSource, type ImageDocumentSource } from './imageDocumentFromSource';
import { readDevelopmentLaunchOptions } from '@/core/development/developmentLaunch';

const ImageMarkToolV3Host = lazy(async () => {
  const module = await import('./ImageMarkToolV3Host');
  return { default: module.ImageMarkToolV3Host };
});

const logger = createLogger('features.imageMark');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

/** 从剪辑画面送来编辑的文档：记下回填位置，切走再回来仍能“送回原位”。 */
const videoEditReturns = new Map<string, string>();

interface ShownDocument {
  document: OpenImageDocument;
  returnTo?: string;
}

interface PendingRecovery {
  info: ImageDocumentRecoveryInfo;
  resolve: (choice: ImageDocumentRecoveryChoice) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function initialShown(): ShownDocument | null {
  const current = getImageDocumentWorkspace().current;
  const document = current ? findOpenImageDocument(current) : undefined;
  if (!document || document.session.isEnded) return null;
  const returnTo = videoEditReturns.get(document.id);
  return { document, ...(returnTo ? { returnTo } : {}) };
}

export interface ImageMarkToolProps {
  /** 返回“工具”首页。本工具自带命令带,返回按钮由它自己渲染,外层不再画标题带。 */
  onBack?: () => void;
}

/**
 * 工具箱“图片编辑”（3.5 图片文档）：
 * - 列表页：全部图片文档（含项目里的），新建来源“打开图片 / 新建空白图片 / 粘贴”，也可拖入图片；
 *   新建即草稿 `.henjiimg`，图片作为文档内容。
 * - 编辑器：命令带左端返回列表（草稿离开三选一），右端“保存 / 另存为 / 导出”。
 * 打开与离开都经图片文档运行时（文档会话）；别处请求打开的文档由这里接手。
 */
export function ImageMarkTool({ onBack }: ImageMarkToolProps = {}): JSX.Element {
  const { t } = useTranslation('ui');
  const developmentLaunch = readDevelopmentLaunchOptions();
  const { showNotification } = useNotification();
  const [shown, setShown] = useState<ShownDocument | null>(initialShown);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<PendingRecovery | null>(null);
  const [isBlankDialogOpen, setIsBlankDialogOpen] = useState(false);
  const workspace = useImageDocumentWorkspace();
  const pendingHandoff = useImageEditorHandoffStore((state) => state.pending);
  const consumeHandoff = useImageEditorHandoffStore((state) => state.consume);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const busyRef = useRef(false);
  const acceptedDevelopmentMediaRef = useRef(false);
  const acceptingHandoffRef = useRef<string | null>(null);

  const show = useCallback((next: ShownDocument | null): void => {
    setShown(next);
    shownRef.current = next;
    setCurrentImageDocument(next?.document.id ?? null);
  }, []);

  /** 同一时间只做一件文档操作（打开、新建、离开、保存）。 */
  const exclusive = useCallback(async (failureKey: string, action: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!isCancelled(error)) {
        logger.error('image_document.toolbox.action.failed', { action: failureKey, error: errorMessage(error) });
        showNotification(t(`imageEditor.v3.host.notifications.${failureKey}`, { message: errorMessage(error) }), 'error');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [showNotification, t]);

  /** 离开当前显示的文档：已保存的写回后关闭；草稿按“保存 / 不保存 / 取消”。取消返回 false。 */
  const leaveShown = useCallback(async (): Promise<boolean> => {
    const current = shownRef.current;
    if (!current) return true;
    const outcome = await leaveImageDocument(current.document.id);
    if (outcome === 'cancelled') return false;
    videoEditReturns.delete(current.document.id);
    show(null);
    return true;
  }, [show]);

  const chooseRecovery = useCallback((info: ImageDocumentRecoveryInfo) => (
    new Promise<ImageDocumentRecoveryChoice>((resolve) => setRecovery({ info, resolve }))
  ), []);

  const openTarget = useCallback((target: DocumentTarget) => exclusive('openFailed', async () => {
    if (shownRef.current?.document.id === target.id) return;
    if (!await leaveShown()) return;
    const document = await openImageDocument(target, { chooseRecovery });
    const returnTo = videoEditReturns.get(document.id);
    show({ document, ...(returnTo ? { returnTo } : {}) });
  }), [chooseRecovery, exclusive, leaveShown, show]);

  const createFrom = useCallback((source: ImageDocumentSource, returnTo?: string) => exclusive('createFailed', async () => {
    if (!await leaveShown()) return;
    // 打开/拖入的本地图片可能在媒体协议默认白名单之外，先授权其所在目录。
    if (isLikelyLocalImagePath(source.url)) {
      await allowMediaRoot(await dirname(source.url)).catch((error: unknown) => {
        logger.warn('image_mark.standalone.allow_root.failed', { error: errorMessage(error) });
      });
    }
    const document = await createImageDocumentFromSource(source);
    if (returnTo) videoEditReturns.set(document.id, returnTo);
    show({ document, ...(returnTo ? { returnTo } : {}) });
  }), [exclusive, leaveShown, show]);

  // 别处请求打开的文档（列表右键、助手、通用打开方式）。
  useEffect(() => {
    const pending = workspace.pending;
    if (!pending) return;
    takePendingImageDocument(pending.key);
    void openTarget(pending.target);
  }, [openTarget, workspace.pending]);

  // 其他工具送来的图片（剪辑画面、查看器、助手）：新建一份草稿图片文档。
  useEffect(() => {
    if (!pendingHandoff || acceptingHandoffRef.current === pendingHandoff.sessionRef) return;
    acceptingHandoffRef.current = pendingHandoff.sessionRef;
    const document: ImageEditDocument = pendingHandoff.document;
    void createFrom({ url: pendingHandoff.sourceUrl, document }, pendingHandoff.sessionRef)
      .finally(() => {
        consumeHandoff(pendingHandoff.sessionRef);
        if (acceptingHandoffRef.current === pendingHandoff.sessionRef) acceptingHandoffRef.current = null;
      });
  }, [consumeHandoff, createFrom, pendingHandoff]);

  // 开发启动参数 --dev-media：用这张图新建一份草稿。
  useEffect(() => {
    if (!developmentLaunch.mediaPath || acceptedDevelopmentMediaRef.current) return;
    acceptedDevelopmentMediaRef.current = true;
    void createFrom({ url: developmentLaunch.mediaPath });
  }, [createFrom, developmentLaunch.mediaPath]);

  const acceptFile = useCallback(async (file: File) => {
    const nativePath = getPathForFile(file);
    await createFrom({ url: nativePath || await readFileAsDataUrl(file) });
  }, [createFrom]);

  const handlePasteFromClipboard = useCallback(async () => {
    const image = await readClipboardImage();
    if (!image) {
      showNotification(t('imageEditor.v3.host.document.pasteEmpty'), 'error');
      return;
    }
    await createFrom({ url: image.dataUrl });
  }, [createFrom, showNotification, t]);

  const handleOpenFile = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) await createFrom({ url: path });
  }, [createFrom]);

  const handleCreateBlank = useCallback((spec: BlankImageSpec) => {
    setIsBlankDialogOpen(false);
    logger.debug('image_mark.blank.create.start', { width: spec.width, height: spec.height, dpi: spec.dpi });
    void createFrom({ url: createBlankImageDataUrl(spec), blank: true });
  }, [createFrom]);

  // 列表页上粘贴图片（截图或复制的图片文件）新建图片文档；编辑器里的粘贴交给编辑器自己。
  useEffect(() => {
    if (shown) return undefined;
    const handlePaste = (event: ClipboardEvent) => {
      const imageFile = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!imageFile) return;
      event.preventDefault();
      void acceptFile(imageFile);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [acceptFile, shown]);

  const handleDropFiles = useCallback((files: File[]) => {
    const file = files.find((entry) =>
      entry.type.startsWith('image/') ||
      IMAGE_EXTENSIONS.some((extension) => entry.name.toLowerCase().endsWith(`.${extension}`))
    );
    if (file) void acceptFile(file);
  }, [acceptFile]);

  const handleOpenDocument = useCallback((document: DocumentSummary) => openTarget({ id: document.id, path: document.path }), [openTarget]);

  const recoveryDialog = recovery ? (
    <AlertDialog
      isOpen
      type="warning"
      title={t('imageEditor.v3.host.document.recovery.title')}
      message={t('imageEditor.v3.host.document.recovery.message', {
        name: recovery.info.name,
        workingTime: new Date(recovery.info.workingSavedAt).toLocaleString(),
        fileTime: new Date(recovery.info.fileSavedAt).toLocaleString(),
      })}
      closeLabel={t('imageEditor.v3.host.document.recovery.cancel')}
      closeImmediately
      onClose={() => { recovery.resolve('cancel'); setRecovery(null); }}
      actions={[
        { label: t('imageEditor.v3.host.document.recovery.discard'), tone: 'danger', onClick: () => { recovery.resolve('discard'); setRecovery(null); } },
        { label: t('imageEditor.v3.host.document.recovery.restore'), variant: 'primary', onClick: () => { recovery.resolve('restore'); setRecovery(null); } },
      ]}
    />
  ) : null;

  const blankDialog = (
    <BlankImageDialog
      isOpen={isBlankDialogOpen}
      onClose={() => setIsBlankDialogOpen(false)}
      onCreate={handleCreateBlank}
    />
  );

  if (!shown) {
    return (
      <>
        {/* 列表页：全部图片文档（含项目里的），返回进标题左侧，新建来源平铺，可把图片拖进来 */}
        <DocumentLibraryPage
          kind="image_document"
          title={t('imageEditor.v3.host.document.title')}
          onBack={onBack}
          backLabel={t('imageEditor.v3.host.backToToolbox')}
          icon={ICON_TOOL_IMAGE_EDIT}
          busy={busy}
          labels={{
            emptyTitle: t('imageEditor.v3.host.document.emptyTitle'),
            emptyDescription: t('imageEditor.v3.host.document.emptyDescription'),
          }}
          describe={(document) => {
            const { width, height, layers } = document.summary;
            return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
              ? t('imageEditor.v3.host.document.describe', { width, height, layers: typeof layers === 'number' ? layers : 0 })
              : undefined;
          }}
          create={{
            kind: 'menu',
            options: [
              { id: 'open', label: t('imageEditor.v3.host.sourceMenu.openFile'), icon: FolderOpen, onSelect: () => void handleOpenFile() },
              { id: 'blank', label: t('imageEditor.v3.host.sourceMenu.createBlank'), icon: FilePlus2, onSelect: () => setIsBlankDialogOpen(true) },
              { id: 'paste', label: t('imageEditor.v3.host.sourceMenu.paste'), icon: ClipboardPaste, onSelect: () => void handlePasteFromClipboard() },
            ],
          }}
          onDropFiles={handleDropFiles}
          onOpen={handleOpenDocument}
        />
        {blankDialog}
        {recoveryDialog}
      </>
    );
  }

  return (
    <>
      <div
        className="flex h-full flex-col"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleDropFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Suspense fallback={<UiLoading message={t('imageEditor.v3.host.loading')} className="h-full" />}>
          <ImageMarkToolV3Host
            key={shown.document.id}
            document={shown.document}
            sourceName={shown.document.session.documentMeta.name}
            videoEditReturn={shown.returnTo}
            onBack={() => void exclusive('leaveFailed', async () => { await leaveShown(); })}
            onOpenFile={handleOpenFile}
            onPasteFromClipboard={handlePasteFromClipboard}
            onCreateBlank={() => setIsBlankDialogOpen(true)}
            onSave={() => exclusive('saveFailed', async () => {
              await saveImageDocument(shown.document.id);
            })}
            onSaveAs={() => exclusive('saveFailed', async () => {
              const saved = await saveImageDocumentAs(shown.document.id);
              if (saved && saved.id !== shown.document.id) show({ document: saved });
            })}
          />
        </Suspense>
      </div>
      {blankDialog}
      {recoveryDialog}
    </>
  );
}

export default ImageMarkTool;
