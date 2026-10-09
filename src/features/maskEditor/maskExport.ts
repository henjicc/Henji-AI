import { createLogger } from '@/core/logging';
import { canvasToDataUrl } from '@/services/imageSource';
import { quickMaskRegionProgram, evaluateQuickMaskProgram } from './regionAdapter';
import type { MaskEditorDocument } from './types';
import { MaskRegionRasterizer } from './regionWorkerClient';

const logger = createLogger('features.maskEditor.export');

type MaskRenderContext = Pick<CanvasRenderingContext2D, 'createImageData' | 'putImageData'>;

function writeCoverage(context: MaskRenderContext, coverage: Float32Array, region: { x: number; y: number; width: number; height: number }): void {
  const image = context.createImageData(region.width, region.height);
  for (let i = 0; i < coverage.length; i++) {
    image.data.fill(255, i * 4, i * 4 + 3);
    image.data[i * 4 + 3] = Math.round((1 - coverage[i]) * 255);
  }
  context.putImageData(image, region.x, region.y);
}

/** Parameter masks are opaque white outside the edited region; coverage is inverted only at PNG encoding. */
export function renderMaskDocument(context: MaskRenderContext, document: MaskEditorDocument): void {
  const program = quickMaskRegionProgram(document);
  for (let y = 0; y < document.height; y += 512) for (let x = 0; x < document.width; x += 512) {
    const region = { x, y, width: Math.min(512, document.width - x), height: Math.min(512, document.height - y) };
    const coverage = evaluateQuickMaskProgram(program, region);
    writeCoverage(context, coverage, region);
  }
}

export async function exportMaskDocumentToPngAsync(document: MaskEditorDocument, signal?: AbortSignal): Promise<string> {
  const startedAt = performance.now();
  logger.info('遮罩导出开始', {
    event: 'mask_editor.export.start',
    width: document.width,
    height: document.height,
    strokeCount: document.strokes.length,
  });
  try {
    const canvas = window.document.createElement('canvas');
    canvas.width = document.width;
    canvas.height = document.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法初始化遮罩画布');
    }
    const rasterizer = new MaskRegionRasterizer(document);
    const cancel = (): void => rasterizer.dispose();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      for (let y = 0; y < document.height; y += 512) for (let x = 0; x < document.width; x += 512) {
        if (signal?.aborted) throw new Error('遮罩导出已取消');
        const region = { x, y, width: Math.min(512, document.width - x), height: Math.min(512, document.height - y) };
        const coverage = await rasterizer.read(region, document);
        if (signal?.aborted) throw new Error('遮罩导出已取消');
        writeCoverage(context, coverage, region);
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      rasterizer.dispose();
    }
    const dataUrl = canvasToDataUrl(canvas);
    logger.info('遮罩导出完成', {
      event: 'mask_editor.export.completed',
      width: canvas.width,
      height: canvas.height,
      strokeCount: document.strokes.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return dataUrl;
  } catch (error) {
    logger.error('遮罩导出失败', {
      event: 'mask_editor.export.failed',
      width: document.width,
      height: document.height,
      strokeCount: document.strokes.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
