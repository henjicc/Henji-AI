import { createLogger } from '@/core/logging';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import { canvasToDataUrl } from '@/services/imageSource';
import { tracePenPath, type PenPathContext } from '@/features/imageMark/render/tracePenPath';
import { isMaskStroke, resolveMaskShapeBounds } from './maskDocument';
import type { MaskEditorDocument, MaskMark, MaskShape, MaskStroke } from './types';

const logger = createLogger('features.maskEditor.export');

type MaskRenderContext = PenPathContext & Pick<
  CanvasRenderingContext2D,
  | 'arc'
  | 'clearRect'
  | 'fill'
  | 'fillRect'
  | 'ellipse'
  | 'closePath'
  | 'restore'
  | 'save'
  | 'stroke'
  | 'globalCompositeOperation'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineCap'
  | 'lineJoin'
  | 'lineWidth'
>;

function traceMaskStroke(context: MaskRenderContext, stroke: MaskStroke): void {
  const points = stroke.points.flatMap((point) => [point.x, point.y]);
  if (points.length === 2) {
    context.beginPath();
    context.arc(points[0], points[1], stroke.size / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  tracePenPath(context, points);
  context.stroke();
}

function fillMaskShape(context: MaskRenderContext, shape: MaskShape): void {
  if (shape.kind === 'rectangle') {
    const [start, end] = shape.points;
    context.fillRect(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y)
    );
    return;
  }
  if (shape.kind === 'circle') {
    const [start, end] = shape.points;
    const bounds = resolveMaskShapeBounds('circle', start, end);
    const radius = bounds.width / 2;
    if (radius === 0) return;
    context.beginPath();
    context.ellipse(
      bounds.x + radius,
      bounds.y + radius,
      radius,
      radius,
      0,
      0,
      Math.PI * 2
    );
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(shape.points[0].x, shape.points[0].y);
  shape.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.fill();
}

function renderMaskMark(context: MaskRenderContext, mark: MaskMark): void {
  if (isMaskStroke(mark)) {
    context.globalCompositeOperation = mark.mode === 'paint' ? 'destination-out' : 'source-over';
    context.lineWidth = mark.size;
    traceMaskStroke(context, mark);
    return;
  }
  context.globalCompositeOperation = 'destination-out';
  fillMaskShape(context, mark);
}

/**
 * GPT Image 遮罩语义：未涂抹区域 alpha=255；用户涂抹区域 alpha=0。
 * 橡皮擦以 source-over 白色恢复不透明区，因而文档可按操作顺序无损重放。
 */
export function renderMaskDocument(
  context: MaskRenderContext,
  document: MaskEditorDocument
): void {
  context.clearRect(0, 0, document.width, document.height);
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = WHITE_HEX;
  context.fillRect(0, 0, document.width, document.height);

  document.strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    context.save();
    context.fillStyle = WHITE_HEX;
    context.strokeStyle = WHITE_HEX;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    renderMaskMark(context, stroke);
    context.restore();
  });
}

export function exportMaskDocumentToPng(document: MaskEditorDocument): string {
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
    renderMaskDocument(context, document);
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
