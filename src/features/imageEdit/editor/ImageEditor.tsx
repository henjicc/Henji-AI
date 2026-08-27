import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IMAGE_EDIT_OPERATION_IDS,
  type ImageEditDocument,
} from '@/core/imageEdit';
import { createLogger } from '@/core/logging';
import { MarkEditor } from '@/features/imageMark/editor/MarkEditor';
import type { MarkEditorStyleState } from '@/features/imageMark/editor/shared';
import { renderOrientedCanvas } from '@/features/imageMark/render/orientedImage';
import { canvasToDataUrl, resolveImageDisplayUrl } from '@/services/imageSource';
import { imageEditExecutionPort } from '../execution/imageEditExecution';
import {
  getEnabledBlurParams,
  withoutBlurOperation,
} from '../execution/browserImageEditExecution';
import { renderBlurredImage } from '../execution/browserBlurRenderer';
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
  /** 宿主前导内容(返回/打开文件/文件名),注入命令带左侧,避免宿主另开一条带 */
  toolbarLeading?: ReactNode;
  toolbarActions?: ReactNode;
  className?: string;
}

export function ImageEditor({
  sourceImageUrl,
  initialDocument,
  onDocumentChange,
  initialStyle,
  onStyleChange,
  toolbarLeading,
  toolbarActions,
  className = 'h-[min(70vh,760px)]',
}: ImageEditorProps): JSX.Element {
  const session = useImageEditorSession({ initialDocument, onDocumentChange });
  const [previewSourceUrl, setPreviewSourceUrl] = useState(sourceImageUrl);
  /**
   * 像素效果预览直接以画好的 canvas 交给 MarkEditor。绕 objectURL 的话每次改参数都要
   * 「toBlob(PNG) → `<img>` 再解码」一趟，实测 1885×1060 要 19.8ms，比整条 GPU 管线
   * （金字塔 3.1ms + 合成 3.0ms）还贵两倍多。Sharp 降级返回的是 URL，仍走下面那条路。
   */
  const [previewFrame, setPreviewFrame] = useState<HTMLCanvasElement | null>(null);
  const [previewOrientationApplied, setPreviewOrientationApplied] = useState(false);
  const [previewState, setPreviewState] = useState<ImageEditorPreviewState>({ phase: 'idle' });
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  /** 与 previewFrame 同步的镜像，供预览调度在不把自身加进依赖的前提下判断有无可显示的帧。 */
  const previewFrameRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageUrlRef = useRef(sourceImageUrl);
  const revisionRef = useRef(0);
  const diffusionEnabled = session.document.operations.some((operation) =>
    operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion && operation.enabled
  );
  const vgpuGlowEnabled = session.document.operations.some((operation) =>
    operation.operationId === IMAGE_EDIT_OPERATION_IDS.vgpuGlow && operation.enabled
  );
  const gpuEffectEnabled = diffusionEnabled || vgpuGlowEnabled;
  const blurParams = getEnabledBlurParams(session.document);
  const rasterEffectEnabled = gpuEffectEnabled || blurParams !== null;
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
    const sourceChanged = sourceImageUrlRef.current !== sourceImageUrl;
    sourceImageUrlRef.current = sourceImageUrl;
    if (!rasterEffectEnabled) {
      setPreviewSourceUrl(sourceImageUrl);
      previewFrameRef.current = null;
      setPreviewFrame(null);
      setPreviewOrientationApplied(false);
      setPreviewState({ phase: 'idle' });
      return;
    }
    // 参数更新期间保留上一张已完成预览；只有底图变化时才立即退回新底图。
    if (sourceChanged) {
      setPreviewSourceUrl(sourceImageUrl);
      previewFrameRef.current = null;
      setPreviewFrame(null);
      setPreviewOrientationApplied(false);
    }
    const revision = ++revisionRef.current;
    const abortController = new AbortController();
    let disposed = false;
    // 拖滑块时每个输入事件都会走到这里。原来先后写入 compiling 和 rendering 两个相位，
    // 等于每个事件让整棵编辑器树多渲染两遍，而这些请求绝大多数会被 Worker 按 revision
    // 直接丢弃。已经有可显示的帧时就不再报进度；没有帧时也要复用同一个相位对象，
    // 否则每次返回新对象照样会触发重渲染。
    setPreviewState((current) => {
      if (previewFrameRef.current) return current;
      return current.phase === 'rendering' ? current : { phase: 'rendering' };
    });
    void (async (): Promise<void> => {
      try {
        let executionSourceUrl = sourceImageUrl;
        let executionDocument = session.document;
        if (blurParams) {
          const blurred = await renderBlurredImage(sourceImageUrl, blurParams, {
            purpose: 'preview',
            maxPixels: 2_000_000,
            signal: abortController.signal,
          });
          if (disposed || revision !== revisionRef.current) return;
          if (!gpuEffectEnabled) {
            const canvas = renderOrientedCanvas(blurred, orientation);
            previewFrameRef.current = canvas;
            setPreviewFrame(canvas);
            setPreviewOrientationApplied(true);
            setPreviewState({ phase: 'idle', backend: 'browser-canvas' });
            return;
          }
          executionSourceUrl = canvasToDataUrl(blurred);
          executionDocument = withoutBlurOperation(session.document);
        }
        if (!gpuEffectEnabled) return;
        const result = await imageEditExecutionPort.execute({
          sourceImageUrl: executionSourceUrl,
          document: executionDocument,
          purpose: 'preview',
          quality: 'realtime',
          maxPixels: 2_000_000,
          previewScopeId: session.sessionId,
          revision,
          requestId: `${session.sessionId}:preview:${revision}`,
          signal: abortController.signal,
        });
        if (disposed || revision !== revisionRef.current || result.kind !== 'preview-frame') {
          closePreviewFrame(result);
          return;
        }
        // WebGPU 与 Sharp 两条路都交回 ImageBitmap；URL 形态只是契约上的遗留可能，
        // 真出现时按「不是我们造的、也就不该由我们释放」处理。
        if (typeof result.frame === 'string') {
          previewFrameRef.current = null;
          setPreviewFrame(null);
          setPreviewSourceUrl(result.frame);
        } else {
          const canvas = drawPreviewFrame(result.frame);
          previewFrameRef.current = canvas;
          setPreviewFrame(canvas);
        }
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
  }, [blurParams, gpuEffectEnabled, orientation, rasterEffectEnabled, session.document, session.sessionId, sourceImageUrl]);

  const documentController = useMemo(() => ({
    ...session.documentController,
    previewState,
  }), [previewState, session.documentController]);
  return (
    <ImageEditorDocumentProvider controller={documentController}>
      <MarkEditor
        key={sourceImageUrl}
        sourceImageUrl={previewSourceUrl}
        sourceFrame={previewFrame}
        sourceOrientationAlreadyApplied={previewOrientationApplied}
        logicalImageSize={logicalImageSize}
        initialDoc={session.markDoc}
        initialStyle={initialStyle}
        onStyleChange={onStyleChange}
        toolbarLeading={toolbarLeading}
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

/**
 * 把 Worker 交回的位图落到一张 canvas 上并立刻释放位图。
 *
 * 每帧新建 canvas 而不是复用同一张：MarkEditor 的 orientedCanvas 按对象身份做 memo，
 * 原地改内容不会触发下游更新。新建 + drawImage 实测 1.0ms，远低于原来 objectURL
 * 往返的 19.8ms。位图当场关闭，不留给 React 生命周期去猜什么时候该释放。
 */
function drawPreviewFrame(frame: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) {
    frame.close();
    throw new Error('无法初始化柔光预览画布');
  }
  context.drawImage(frame, 0, 0);
  frame.close();
  return canvas;
}
