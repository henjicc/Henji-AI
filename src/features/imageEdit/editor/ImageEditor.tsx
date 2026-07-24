import type { ReactNode } from 'react';
import type { ImageEditDocument } from '@/core/imageEdit';
import { MarkEditor } from '@/features/imageMark/editor/MarkEditor';
import type { MarkEditorStyleState } from '@/features/imageMark/editor/shared';
import { ImageToolPanel } from './ImageToolPanel';
import { useImageEditorSession } from './useImageEditorSession';

export interface ImageEditorProps {
  sourceImageUrl: string;
  initialDocument?: ImageEditDocument | null;
  onDocumentChange?: (document: ImageEditDocument) => void;
  initialStyle?: Partial<MarkEditorStyleState>;
  onStyleChange?: (style: MarkEditorStyleState) => void;
  toolbarActions?: ReactNode;
  className?: string;
}

export function ImageEditor({
  sourceImageUrl,
  initialDocument,
  onDocumentChange,
  initialStyle,
  onStyleChange,
  toolbarActions,
  className = 'h-[min(70vh,760px)]',
}: ImageEditorProps): JSX.Element {
  const session = useImageEditorSession({ initialDocument, onDocumentChange });
  return (
    <MarkEditor
      key={sourceImageUrl}
      sourceImageUrl={sourceImageUrl}
      initialDoc={session.markDoc}
      initialStyle={initialStyle}
      onStyleChange={onStyleChange}
      toolbarActions={toolbarActions}
      className={className}
      layout="shell"
      documentController={session.markController}
      rightPanel={<ImageToolPanel />}
    />
  );
}
