import type Konva from 'konva';
import { describe, expect, it } from 'vitest';
import type { ArrowMark, PenMark } from '../domain/types';
import { applyNodeTransformToMark } from './nodeSync';

function createNodeTransform(
  initialX: number,
  initialY: number,
  initialScaleX: number,
  initialScaleY: number
): { node: Konva.Node; read: () => [number, number, number, number] } {
  let x = initialX;
  let y = initialY;
  let scaleX = initialScaleX;
  let scaleY = initialScaleY;
  const node = {
    x(value?: number) {
      if (value !== undefined) x = value;
      return x;
    },
    y(value?: number) {
      if (value !== undefined) y = value;
      return y;
    },
    scaleX(value?: number) {
      if (value !== undefined) scaleX = value;
      return scaleX;
    },
    scaleY(value?: number) {
      if (value !== undefined) scaleY = value;
      return scaleY;
    },
  } as unknown as Konva.Node;
  return { node, read: () => [x, y, scaleX, scaleY] };
}

describe('applyNodeTransformToMark', () => {
  it('keeps a pen anchored when Konva scales its absolute points around the top-left', () => {
    const pen: PenMark = {
      id: 'pen-1',
      type: 'pen',
      points: [100, 120, 150, 160, 200, 220],
      stroke: 'red',
      lineWidth: 4,
    };
    // 以 (100,120) 为左上锚点放大 2 倍时，Konva 的节点平移量为 anchor * (1-scale)。
    const { node, read } = createNodeTransform(-100, -120, 2, 2);

    const transformed = applyNodeTransformToMark(pen, node) as PenMark;

    expect(transformed.points).toEqual([100, 120, 200, 200, 300, 320]);
    expect(read()).toEqual([0, 0, 1, 1]);
  });

  it('applies the same node transform to arrow endpoints and its curve control', () => {
    const arrow: ArrowMark = {
      id: 'arrow-1',
      type: 'arrow',
      points: [100, 100, 200, 200],
      curveControl: [150, 50],
      stroke: 'red',
      lineWidth: 4,
    };
    const { node } = createNodeTransform(-100, 20, 2, 0.5);

    const transformed = applyNodeTransformToMark(arrow, node) as ArrowMark;

    expect(transformed.points).toEqual([100, 70, 300, 120]);
    expect(transformed.curveControl).toEqual([200, 45]);
  });
});
