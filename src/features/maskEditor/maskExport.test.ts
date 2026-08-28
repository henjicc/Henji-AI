import { describe, expect, it, vi } from 'vitest';
import { createEmptyMaskDocument } from './maskDocument';
import { renderMaskDocument } from './maskExport';

function createRecordingContext() {
  const composites: GlobalCompositeOperation[] = [];
  const lineWidths: number[] = [];
  const context = {
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    fillStyle: '',
    strokeStyle: '',
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    lineWidth: 1,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fill: vi.fn(() => {
      composites.push(context.globalCompositeOperation);
      lineWidths.push(context.lineWidth);
    }),
    stroke: vi.fn(() => {
      composites.push(context.globalCompositeOperation);
      lineWidths.push(context.lineWidth);
    }),
  };
  return { context, composites, lineWidths };
}

describe('renderMaskDocument', () => {
  it('先生成同尺寸不透明底，再将涂抹区置透明、橡皮擦区恢复不透明', () => {
    const document = {
      ...createEmptyMaskDocument('source-a', 640, 480),
      strokes: [
        {
          id: 'paint',
          mode: 'paint' as const,
          size: 40,
          points: [{ x: 100, y: 120 }, { x: 140, y: 160 }],
        },
        {
          id: 'erase',
          mode: 'erase' as const,
          size: 12,
          points: [{ x: 120, y: 140 }],
        },
      ],
    };
    const recording = createRecordingContext();

    renderMaskDocument(recording.context, document);

    expect(recording.context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(recording.context.fillRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(recording.composites).toEqual(['destination-out', 'source-over']);
    expect(recording.lineWidths).toEqual([40, 12]);
    expect(recording.context.arc).toHaveBeenCalledWith(120, 140, 6, 0, Math.PI * 2);
  });

  it('复用平滑笔迹路径而不是按预览与导出分别实现采样', () => {
    const document = {
      ...createEmptyMaskDocument('source-a', 100, 100),
      strokes: [{
        id: 'curve',
        mode: 'paint' as const,
        size: 8,
        points: [{ x: 1, y: 1 }, { x: 10, y: 10 }, { x: 20, y: 5 }, { x: 30, y: 20 }],
      }],
    };
    const recording = createRecordingContext();

    renderMaskDocument(recording.context, document);

    expect(recording.context.quadraticCurveTo).toHaveBeenCalled();
    expect(recording.context.stroke).toHaveBeenCalledTimes(1);
  });
});
