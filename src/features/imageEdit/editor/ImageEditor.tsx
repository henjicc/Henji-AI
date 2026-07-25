import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IMAGE_EDIT_OPERATION_IDS, type ImageEditDocument, type ImageEditPreviewExecutionResult } from '@/core/imageEdit';
import { createLogger } from '@/core/logging';
import { MarkEditor } from '@/features/imageMark/editor/MarkEditor';
import type { MarkEditorStyleState } from '@/features/imageMark/editor/shared';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import { imageEditExecutionPort } from '../execution/imageEditExecution';
import { ImageToolPanel } from './ImageToolPanel';
import { ImageEditorDocumentProvider } from './ImageEditorDocumentProvider';
import type { ImageEditorPreviewState } from './ImageEditorDocumentContext';
import { useImageEditorSession } from './useImageEditorSession';

const logger = createLogger('features.imageEdit.editor');

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
  const [previewSourceUrl, setPreviewSourceUrl] = useState(sourceImageUrl);
  const [previewOrientationApplied, setPreviewOrientationApplied] = useState(false);
  const [previewState, setPreviewState] = useState<ImageEditorPreviewState>({ phase: 'idle' });
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const diffusionEnabled = session.document.operations.some((operation) =>
    operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion && operation.enabled
  );
  const orientation = session.markDoc.orientation;
  const logicalImageSize = useMemo(() => {
    if (!sourceSize) return undefined;
    return orientation.rotate === 90 || orientation.rotate === 270
      ? { width: sourceSize.height, height: sourceSize.width }
      : sourceSize;
  }, [orientation.rotate, sourceSize]);

  useEffect(() => {
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (!disposed) setSourceSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (!disposed) setSourceSize(null);
    };
    image.src = resolveImageDisplayUrl(sourceImageUrl);
    return () => { disposed = true; };
  }, [sourceImageUrl]);

  useEffect(() => {
    if (!diffusionEnabled) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setPreviewSourceUrl(sourceImageUrl);
      setPreviewOrientationApplied(false);
      setPreviewState({ phase: 'idle' });
      return;
    }
    const revision = ++revisionRef.current;
    const abortController = new AbortController();
    let disposed = false;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewSourceUrl(sourceImageUrl);
    setPreviewOrientationApplied(false);
    setPreviewState({ phase: 'compiling' });
    void (async (): Promise<void> => {
      try {
        setPreviewState({ phase: 'rendering' });
        const result = await imageEditExecutionPort.execute({
          sourceImageUrl,
          document: session.document,
          purpose: 'preview',
          quality: 'realtime',
          maxPixels: 2_000_000,
          revision,
          requestId: `image-editor-preview-${revision}`,
          signal: abortController.signal,
        });
        if (disposed || revision !== revisionRef.current || result.kind !== 'preview-frame') {
          closePreviewFrame(result);
          return;
        }
        const nextUrl = await previewFrameToObjectUrl(result);
        if (disposed || revision !== revisionRef.current) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = nextUrl;
        setPreviewSourceUrl(nextUrl);
        setPreviewOrientationApplied(true);
        setPreviewState(result.backend === 'sharp'
          ? {
            phase: 'degraded',
            backend: result.backend,
            fallbackReason: result.diagnostics?.fallbackReason,
          }
          : { phase: 'idle', backend: result.backend });
      } catch (error) {
        if (disposed || abortController.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('image_edit.preview.failed', { revision, error: message });
        setPreviewState({ phase: 'failed', message });
      }
    })();
    return () => {
      disposed = true;
      abortController.abort();
    };
  }, [diffusionEnabled, session.document, sourceImageUrl]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const documentController = useMemo(() => ({
    ...session.documentController,
    previewState,
  }), [previewState, session.documentController]);
  return (
    <ImageEditorDocumentProvider controller={documentController}>
      <MarkEditor
        key={sourceImageUrl}
        sourceImageUrl={previewSourceUrl}
        sourceOrientationAlreadyApplied={previewOrientationApplied}
        logicalImageSize={logicalImageSize}
        initialDoc={session.markDoc}
        initialStyle={initialStyle}
        onStyleChange={onStyleChange}
        toolbarActions={toolbarActions}
        className={className}
        layout="shell"
        documentController={session.markController}
        rightPanel={<ImageToolPanel />}
      />
    </ImageEditorDocumentProvider>
  );
}

function closePreviewFrame(result: { kind: string; frame?: unknown }): void {
  if (result.kind === 'preview-frame' && result.frame instanceof ImageBitmap) result.frame.close();
}

async function previewFrameToObjectUrl(result: ImageEditPreviewExecutionResult): Promise<string> {
  if (typeof result.frame === 'string') return result.frame;
  const canvas = document.createElement('canvas');
  canvas.width = result.frame.width;
  canvas.height = result.frame.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法初始化柔光预览画布');
  context.drawImage(result.frame, 0, 0);
  result.frame.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法编码柔光预览')));
  });
  return URL.createObjectURL(blob);
}
