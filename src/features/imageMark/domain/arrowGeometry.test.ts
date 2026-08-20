import { describe, expect, it } from 'vitest';
import { sanitizeMarkItem } from '@/core/imageEdit';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import { applyOrientationOpToDoc, updateMarkPosition, updateMarkTransform } from './geometry';
import { createEmptyMarkDoc } from './types';
import {
  arrowCurveHandleToControl,
  arrowToKonvaBezierPoints,
  resolveArrowControl,
  resolveArrowCurveHandle,
  resolveArrowHeadPoints,
  resolveArrowVisualBounds,
  stabilizeStraightArrowBounds,
} from './arrowGeometry';
import type { ArrowMark } from './types';

const arrow: ArrowMark = {
  id: 'arrow-1',
  type: 'arrow',
  points: [10, 20, 110, 60],
  stroke: WHITE_HEX,
  lineWidth: 3,
};

describe('弯曲箭头几何', () => {
  it('直箭头缺省控制点位于中点', () => {
    expect(resolveArrowControl(arrow)).toEqual([60, 40]);
  });

  it('把二次控制点等价转换为 Konva 三次贝塞尔点', () => {
    const points = arrowToKonvaBezierPoints(arrow, [60, 100]);
    expect(points).toHaveLength(8);
    expect(points.slice(0, 2)).toEqual([10, 20]);
    expect(points.slice(-2)).toEqual([110, 60]);
    expect(points[2]).toBeCloseTo(43.333333, 5);
    expect(points[5]).toBeCloseTo(86.666667, 5);
  });

  it('交互手柄落在曲线上，并能无跳变地反解回内部控制点', () => {
    const curved: ArrowMark = { ...arrow, curveControl: [60, 100] };
    const handle = resolveArrowCurveHandle(curved);
    expect(handle).toEqual([60, 70]);
    expect(arrowCurveHandleToControl(curved, handle)).toEqual([60, 100]);
    expect(resolveArrowCurveHandle(arrow)).toEqual([60, 40]);
  });

  it('移动和缩放箭头时控制点与端点保持同一变换', () => {
    const curved: ArrowMark = { ...arrow, curveControl: [40, 90] };
    const moved = updateMarkPosition(curved, 30, 50) as ArrowMark;
    expect(moved.points).toEqual([30, 50, 130, 90]);
    expect(moved.curveControl).toEqual([60, 120]);

    const transformed = updateMarkTransform(curved, 0, 0, 2, 0.5) as ArrowMark;
    expect(transformed.points).toEqual([0, 0, 200, 20]);
    expect(transformed.curveControl).toEqual([60, 35]);
  });

  it('旋转图片时同步重映射弧线控制点', () => {
    const curved: ArrowMark = { ...arrow, curveControl: [40, 90] };
    const rotated = applyOrientationOpToDoc(
      { ...createEmptyMarkDoc(), items: [curved] },
      200,
      100,
      'rotate-cw'
    );
    expect(rotated.items[0]).toMatchObject({
      points: [80, 10, 40, 110],
      curveControl: [10, 40],
    });
  });

  it('编解码清洗会保留合法控制点并忽略损坏的可选控制点', () => {
    expect(sanitizeMarkItem({ ...arrow, curveControl: [25, 75] })).toMatchObject({
      curveControl: [25, 75],
    });
    expect(sanitizeMarkItem({ ...arrow, curveControl: ['bad', 75] })).not.toHaveProperty('curveControl');
  });

  it('水平和竖直箭头始终具有非零可缩放边界', () => {
    const horizontal = resolveArrowVisualBounds({ ...arrow, points: [20, 40, 180, 40] });
    const vertical = resolveArrowVisualBounds({ ...arrow, points: [80, 20, 80, 220] });

    expect(horizontal.width).toBeGreaterThan(0);
    expect(horizontal.height).toBeGreaterThanOrEqual(10);
    expect(vertical.width).toBeGreaterThanOrEqual(10);
    expect(vertical.height).toBeGreaterThan(0);
  });

  it('箭头头部沿末端切线生成固定尺寸三角形', () => {
    const points = resolveArrowHeadPoints({ ...arrow, points: [20, 40, 180, 40] });
    expect(points.slice(0, 2)).toEqual([180, 40]);
    expect(points[2]).toBeLessThan(180);
    expect(points[4]).toBeLessThan(180);
    expect(Math.min(points[3], points[5])).toBeLessThan(40);
    expect(Math.max(points[3], points[5])).toBeGreaterThan(40);
  });

  it('弯箭头边界包含曲线在端点之外的极值', () => {
    const bounds = resolveArrowVisualBounds({
      ...arrow,
      points: [20, 100, 120, 100],
      curveControl: [220, 100],
    });
    expect(bounds.x + bounds.width).toBeGreaterThan(130);
  });

  it('水平和竖直直箭头只缩放真实存在的长度轴', () => {
    const oldBounds = { x: 20, y: 30, width: 160, height: 12 };
    expect(stabilizeStraightArrowBounds(
      { ...arrow, points: [20, 40, 180, 40] },
      oldBounds,
      { x: 20, y: 10, width: 240, height: 80 }
    )).toEqual({ x: 20, y: 30, width: 240, height: 12 });

    expect(stabilizeStraightArrowBounds(
      { ...arrow, points: [80, 20, 80, 220] },
      oldBounds,
      { x: 5, y: 20, width: 90, height: 300 }
    )).toEqual({ x: 20, y: 20, width: 160, height: 300 });
  });

  it('弯箭头保留完整的二维缩放边界', () => {
    const nextBounds = { x: 5, y: 10, width: 240, height: 80 };
    expect(stabilizeStraightArrowBounds(
      { ...arrow, curveControl: [80, 120] },
      { x: 20, y: 30, width: 160, height: 12 },
      nextBounds
    )).toBe(nextBounds);
  });
});
