import {
  fitWithinPixelBudget,
  IMAGE_BLUR_ALGORITHMS,
  type BlurOperationParams,
  type ImageBlurAlgorithmId,
} from '@/core/imageEdit';
import { createLogger } from '@/core/logging';
import { loadImageElement } from '@/services/imageSource';

const logger = createLogger('features.imageEdit.execution');

type BlurRenderer = (
  source: HTMLImageElement,
  width: number,
  height: number,
  strength: number,
) => HTMLCanvasElement;

const BLUR_RENDERERS: Record<ImageBlurAlgorithmId, BlurRenderer> = {
  gaussian: renderGaussianBlur,
};

export async function renderBlurredImage(
  sourceImageUrl: string,
  params: BlurOperationParams,
  options: { purpose: 'preview' | 'export'; maxPixels?: number; signal?: AbortSignal },
): Promise<HTMLCanvasElement> {
  const startedAt = performance.now();
  logger.debug('模糊渲染开始', {
    event: 'image_edit.blur.render.start',
    context: {
      algorithm: params.algorithm,
      purpose: options.purpose,
    },
  });
  try {
    throwIfAborted(options.signal);
    const image = await loadImageElement(sourceImageUrl);
    if (options.purpose === 'preview') await nextAnimationFrame();
    throwIfAborted(options.signal);
    const size = options.maxPixels === undefined
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : fitWithinPixelBudget(image.naturalWidth, image.naturalHeight, options.maxPixels);
    const renderer = BLUR_RENDERERS[params.algorithm];
    if (!renderer) {
      const available = IMAGE_BLUR_ALGORITHMS.map((algorithm) => algorithm.label).join('、');
      throw new Error(`不支持的模糊算法，可用算法：${available}`);
    }
    const result = renderer(image, size.width, size.height, params.strength);
    logger.debug('模糊渲染完成', {
      event: 'image_edit.blur.render.completed',
      context: {
        algorithm: params.algorithm,
        purpose: options.purpose,
        width: result.width,
        height: result.height,
        durationMs: Math.round(performance.now() - startedAt),
      },
    });
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    logger.error('模糊渲染失败', {
      event: 'image_edit.blur.render.failed',
      error: error instanceof Error ? error.message : String(error),
      context: {
        algorithm: params.algorithm,
        purpose: options.purpose,
      },
    });
    throw error;
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('模糊预览已取消', 'AbortError');
}

function renderGaussianBlur(
  source: HTMLImageElement,
  width: number,
  height: number,
  strength: number,
): HTMLCanvasElement {
  const sourceSize = { width: source.naturalWidth, height: source.naturalHeight };
  const radius = Math.min(120, Math.max(0, strength * Math.min(width, height) * 0.04));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const output = canvas.getContext('2d');
  if (!output) throw new Error('无法初始化模糊画布');

  if (radius < 0.01) {
    output.drawImage(source, 0, 0, sourceSize.width, sourceSize.height, 0, 0, width, height);
    return canvas;
  }

  // 给边缘补上夹取色，避免高斯核在图片边界采到透明像素而发黑。
  const padding = Math.max(2, Math.ceil(radius * 3));
  const padded = document.createElement('canvas');
  padded.width = width + padding * 2;
  padded.height = height + padding * 2;
  const paddedContext = padded.getContext('2d');
  if (!paddedContext) throw new Error('无法初始化模糊缓冲画布');
  paddedContext.drawImage(source, 0, 0, sourceSize.width, sourceSize.height, padding, padding, width, height);
  paddedContext.drawImage(source, 0, 0, 1, sourceSize.height, 0, padding, padding, height);
  paddedContext.drawImage(source, sourceSize.width - 1, 0, 1, sourceSize.height, padding + width, padding, padding, height);
  paddedContext.drawImage(source, 0, 0, sourceSize.width, 1, padding, 0, width, padding);
  paddedContext.drawImage(source, 0, sourceSize.height - 1, sourceSize.width, 1, padding, padding + height, width, padding);
  paddedContext.drawImage(source, 0, 0, 1, 1, 0, 0, padding, padding);
  paddedContext.drawImage(source, sourceSize.width - 1, 0, 1, 1, padding + width, 0, padding, padding);
  paddedContext.drawImage(source, 0, sourceSize.height - 1, 1, 1, 0, padding + height, padding, padding);
  paddedContext.drawImage(source, sourceSize.width - 1, sourceSize.height - 1, 1, 1, padding + width, padding + height, padding, padding);

  output.filter = `blur(${radius}px)`;
  output.drawImage(padded, -padding, -padding);
  return canvas;
}
