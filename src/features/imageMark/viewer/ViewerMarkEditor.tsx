import { useCallback, useMemo, useRef, useState } from 'react';
import { createLogger } from '@/core/logging';
import {
  coerceImageEditSession,
  type ImageEditDocument,
  type ImageEditSession,
  type ImageMarkSession,
} from '@/core/imageEdit';
import { UiButton } from '@/components/ui';
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution';
import { ImageEditor } from '@/features/imageEdit/editor/ImageEditor';

const logger = createLogger('features.imageMark');

interface ViewerMarkEditorProps {
  /** 当前查看的图片(可能是已合成的编辑结果) */
  imageUrl: string;
  /** 已有编辑会话:基于原图 + 标记文档做非破坏性再编辑 */
  session?: ImageEditSession | ImageMarkSession;
  onClose: () => void;
  onSave: (dataUrl: string, session: ImageEditSession) => void;
}

/**
 * 查看器编辑模式兼容宿主：全屏挂载共享 ImageEditor，保留原公开组件名。
 */
export function ViewerMarkEditor({
  imageUrl,
  session,
  onClose,
  onSave,
}: ViewerMarkEditorProps): JSX.Element {
  const initialSession = useMemo(
    () => coerceImageEditSession(session, imageUrl),
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
    <div className="h-full w-full bg-app p-4">
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
