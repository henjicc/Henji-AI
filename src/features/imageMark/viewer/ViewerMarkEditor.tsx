import { useCallback, useRef, useState } from 'react';
import { createLogger } from '@/core/logging';
import { UiButton } from '@/components/ui';
import { createEmptyMarkDoc, type ImageMarkDoc, type ImageMarkSession } from '../domain/types';
import { exportMarkedImage } from '../render/exportMarkedImage';
import { MarkEditor } from '../editor/MarkEditor';

const logger = createLogger('features.imageMark');

interface ViewerMarkEditorProps {
  /** 当前查看的图片(可能是已合成的编辑结果) */
  imageUrl: string;
  /** 已有编辑会话:基于原图 + 标记文档做非破坏性再编辑 */
  session?: ImageMarkSession;
  onClose: () => void;
  onSave: (dataUrl: string, session: ImageMarkSession) => void;
}

/**
 * 查看器编辑模式宿主:全屏包一层 MarkEditor,取消/保存挂在工具行右侧。
 */
export function ViewerMarkEditor({
  imageUrl,
  session,
  onClose,
  onSave,
}: ViewerMarkEditorProps): JSX.Element {
  const sourceUrl = session?.sourceUrl ?? imageUrl;
  const docRef = useRef<ImageMarkDoc>(session?.doc ?? createEmptyMarkDoc());
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const dataUrl = await exportMarkedImage(sourceUrl, docRef.current);
      onSave(dataUrl, { sourceUrl, doc: docRef.current });
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
      <MarkEditor
        key={sourceUrl}
        sourceImageUrl={sourceUrl}
        initialDoc={session?.doc ?? null}
        onDocChange={(doc) => {
          docRef.current = doc;
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
