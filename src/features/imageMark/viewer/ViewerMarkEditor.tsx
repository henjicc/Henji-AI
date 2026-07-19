import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createLogger } from '@/core/logging';
import { UiButton, UiIconButton } from '@/components/ui';
import { createEmptyMarkDoc, type ImageMarkDoc, type ImageMarkSession } from '../domain/types';
import { exportMarkedImage } from '../render/exportMarkedImage';
import { MarkEditor } from '../editor/MarkEditor';

const logger = createLogger('features.imageMark');

interface ViewerMarkEditorProps {
  /** 当前查看的图片(可能是已合成的编辑结果) */
  imageUrl: string;
  /** 已有编辑会话:基于原图 + 标记文档做非破坏性再编辑 */
  session?: ImageMarkSession;
  imageList?: string[];
  currentIndex?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
  onClose: () => void;
  onSave: (dataUrl: string, session: ImageMarkSession) => void;
}

/**
 * 查看器编辑模式宿主:全屏包一层 MarkEditor,保存时导出合成图并回传会话。
 */
export function ViewerMarkEditor({
  imageUrl,
  session,
  imageList = [],
  currentIndex = 0,
  onNavigate,
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
    <div className="flex h-full w-full flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center gap-2">
        <UiButton variant="ghost" size="sm" onClick={onClose}>
          取消
        </UiButton>
        <div className="flex-1" />
        {imageList.length > 1 && onNavigate && (
          <div className="flex items-center gap-2">
            <UiIconButton className="h-8 w-8" title="上一张" onClick={() => onNavigate('prev')}>
              <ChevronLeft size={16} />
            </UiIconButton>
            <span className="text-xs text-white/80">
              {currentIndex + 1} / {imageList.length}
            </span>
            <UiIconButton className="h-8 w-8" title="下一张" onClick={() => onNavigate('next')}>
              <ChevronRight size={16} />
            </UiIconButton>
          </div>
        )}
        <div className="flex-1" />
        <UiButton variant="primary" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? '保存中…' : '保存'}
        </UiButton>
      </div>

      <MarkEditor
        key={sourceUrl}
        sourceImageUrl={sourceUrl}
        initialDoc={session?.doc ?? null}
        onDocChange={(doc) => {
          docRef.current = doc;
        }}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
