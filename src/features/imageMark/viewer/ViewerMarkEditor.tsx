import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/core/logging';
import {
  coerceImageEditSession,
  isImageEditSessionReferenceV3,
  type ImageEditDocument,
  type ImageEditSessionData,
  type ImageEditSessionReferenceV3,
  type ImageMarkSession,
} from '@/core/imageEdit';
import { UiButton, UiLoading } from '@/components/ui';
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution';
import { ImageEditor } from '@/features/imageEdit/editor/ImageEditor';
import { isImageEditorV3Enabled } from '@/platform/runtime';

const ViewerMarkEditorV3Host = lazy(() => import('./ViewerMarkEditorV3Host').then((module) => ({
  default: module.ViewerMarkEditorV3Host,
})));

const logger = createLogger('features.imageMark');

export interface ViewerMarkEditorProps {
  /** 当前查看的图片(可能是已合成的编辑结果) */
  imageUrl: string;
  /** 已有编辑会话:基于原图 + 标记文档做非破坏性再编辑 */
  session?: ImageEditSessionData | ImageMarkSession;
  onClose: () => void;
  onSave: (mediaUrl: string, session: ImageEditSessionData) => void;
  onSessionChange?: (session: ImageEditSessionReferenceV3) => void;
}

/**
 * 查看器编辑模式兼容宿主：全屏挂载共享 ImageEditor，保留原公开组件名。
 */
function LegacyViewerMarkEditor({
  imageUrl,
  session,
  onClose,
  onSave,
}: Omit<ViewerMarkEditorProps, 'onSessionChange'>): JSX.Element {
  const initialSession = useMemo(
    () => coerceImageEditSession(
      isImageEditSessionReferenceV3(session) ? undefined : session,
      imageUrl,
    ),
    [imageUrl, session]
  );
  const sourceUrl = initialSession.sourceUrl;
  const documentRef = useRef<ImageEditDocument>(initialSession.document);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    logger.debug('image_mark.viewer.save.start');
    try {
      const document = documentRef.current;
      const dataUrl = await exportImageEditDocument(sourceUrl, document);
      onSave(dataUrl, { sourceUrl, document });
      logger.info('image_mark.viewer.save.completed');
    } catch (error) {
      logger.error('image_mark.viewer.save.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onSave, sourceUrl]);

  return (
    /* 全屏编辑宿主:编辑器铺满,不靠外层留白把它衬成一张浮起来的卡 */
    <div className="h-full w-full bg-app">
      <ImageEditor
        key={sourceUrl}
        sourceImageUrl={sourceUrl}
        initialDocument={initialSession.document}
        onDocumentChange={(document) => {
          documentRef.current = document;
        }}
        toolbarActions={
          <>
            <UiButton variant="ghost" size="sm" onClick={onClose}>
              取消
            </UiButton>
            <UiButton variant="primary" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving ? '保存中…' : '保存'}
            </UiButton>
          </>
        }
        className="h-full"
      />
    </div>
  );
}

export function ViewerMarkEditor(props: ViewerMarkEditorProps): JSX.Element {
  if (!isImageEditorV3Enabled()) {
    return <LegacyViewerMarkEditor {...props} />;
  }

  const sessionKey = isImageEditSessionReferenceV3(props.session)
    ? props.session.documentRef
    : props.imageUrl;
  return (
    <Suspense fallback={<UiLoading message="正在打开快速编辑…" className="h-full" />}>
      <ViewerMarkEditorV3Host
        key={sessionKey}
        imageUrl={props.imageUrl}
        session={props.session}
        onClose={props.onClose}
        onSave={props.onSave}
        onSessionChange={props.onSessionChange}
      />
    </Suspense>
  );
}
