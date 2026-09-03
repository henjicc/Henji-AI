import { describe, expect, it, vi } from 'vitest';
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  BLACK_HEX,
  WHITE_HEX,
} from '@/core/theme/colorTokens';
import type { ImageEditCanvasContext } from './canvasAdapter';
import { drawMarkItems } from './drawMarks';

function createContext(): ImageEditCanvasContext & {
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  paintOperations: string[];
  strokeSnapshots: Array<{
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    lineWidth: number;
  }>;
  shadowColor?: string;
} {
  const paintOperations: string[] = [];
  const strokeSnapshots: Array<{
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    lineWidth: number;
  }> = [];
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(() => paintOperations.push('fill')),
    stroke: vi.fn(() => {
      paintOperations.push('stroke');
      strokeSnapshots.push({
        lineCap: context.lineCap,
        lineJoin: context.lineJoin,
        lineWidth: context.lineWidth,
      });
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    lineWidth: 1,
    paintOperations,
    strokeSnapshots,
  } as unknown as ImageEditCanvasContext & {
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    paintOperations: string[];
    strokeSnapshots: Array<{
      lineCap: CanvasLineCap;
      lineJoin: CanvasLineJoin;
      lineWidth: number;
    }>;
    shadowColor?: string;
  };
  return context;
}

describe('标注文字光栅化', () => {
  it('开启时先绘制纯色背景，且文字与序号不再写入阴影', () => {
    const context = createContext();
    drawMarkItems(context, [
      {
        id: 'text',
        type: 'text',
        x: 20,
        y: 30,
        text: '说明',
        color: BLACK_HEX,
        fontSize: 20,
        backgroundColor: WHITE_HEX,
      },
      {
        id: 'number',
        type: 'number',
        x: 80,
        y: 90,
        color: ANNOTATION_DEFAULT_STROKE_HEX,
        fontSize: 20,
      },
    ], 200, 200);

    expect(context.fillRect).toHaveBeenCalledTimes(1);
    expect(context.fillRect).toHaveBeenCalledWith(16, 26, 48, 32);
    expect(context.fillText).toHaveBeenCalledWith('说明', 20, 30);
    expect(context.shadowColor).toBeUndefined();
  });

  it('缺省背景的旧文字不绘制背景块', () => {
    const context = createContext();
    drawMarkItems(context, [{
      id: 'text',
      type: 'text',
      x: 20,
      y: 30,
      text: '说明',
      color: BLACK_HEX,
      fontSize: 20,
    }], 200, 200);

    expect(context.fillRect).not.toHaveBeenCalled();
  });
});

describe('箭头光栅化', () => {
  it('先绘制圆角箭身，再用尖角描边覆盖箭头头部', () => {
    const context = createContext();

    drawMarkItems(context, [{
      id: 'arrow',
      type: 'arrow',
      points: [20, 30, 180, 120],
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 12,
    }], 200, 160);

    expect(context.paintOperations).toEqual(['stroke', 'fill', 'stroke']);
    expect(context.strokeSnapshots).toEqual([
      { lineCap: 'round', lineJoin: 'round', lineWidth: 12 },
      { lineCap: 'butt', lineJoin: 'miter', lineWidth: 12 },
    ]);
  });
});
