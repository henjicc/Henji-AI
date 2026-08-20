import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import type { ArrowMark } from '../domain/types';
import {
  ARROW_HITBOX_NODE_NAME,
  ARROW_SHAFT_NODE_NAME,
  updateArrowNodeGeometry,
} from './arrowNodes';

function createArrowGroup(): Konva.Group {
  const group = new Konva.Group();
  group.add(new Konva.Rect({ name: ARROW_HITBOX_NODE_NAME, fill: 'transparent' }));
  group.add(new Konva.Line({ name: ARROW_SHAFT_NODE_NAME }));
  return group;
}

describe('updateArrowNodeGeometry', () => {
  it('gives a vertical arrow a stable non-zero group width', () => {
    const item: ArrowMark = {
      id: 'vertical-arrow',
      type: 'arrow',
      points: [80, 20, 80, 220],
      stroke: 'red',
      lineWidth: 3,
    };
    const group = createArrowGroup();

    updateArrowNodeGeometry(group, item);

    const bounds = group.getClientRect({ skipTransform: true, skipStroke: true });
    expect(bounds.width).toBeGreaterThanOrEqual(10);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('updates the shaft and hitbox together when an arrow becomes curved', () => {
    const item: ArrowMark = {
      id: 'curved-arrow',
      type: 'arrow',
      points: [20, 100, 120, 100],
      curveControl: [220, 100],
      stroke: 'red',
      lineWidth: 3,
    };
    const group = createArrowGroup();

    updateArrowNodeGeometry(group, item);

    const shaft = group.findOne<Konva.Line>(`.${ARROW_SHAFT_NODE_NAME}`);
    expect(shaft?.bezier()).toBe(true);
    expect(shaft?.points()).toHaveLength(8);
    expect(group.getClientRect({ skipTransform: true }).x + group.getClientRect({ skipTransform: true }).width)
      .toBeGreaterThan(130);
  });
});
