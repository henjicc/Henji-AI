import type Konva from 'konva';
import type { Container } from 'konva/lib/Container';
import {
  arrowToKonvaBezierPoints,
  resolveArrowHeadPoints,
  resolveArrowVisualBounds,
} from '../domain/arrowGeometry';
import type { ArrowMark } from '../domain/types';

export const ARROW_SHAFT_NODE_NAME = 'image-mark-arrow-shaft';
export const ARROW_HITBOX_NODE_NAME = 'image-mark-arrow-hitbox';

export function arrowHeadNodeId(itemId: string): string {
  return `image-mark-arrow-head-${itemId}`;
}

export function resolveArrowShaftNode(node: Konva.Node): Konva.Line | null {
  const container = node as unknown as Container;
  if (typeof container.findOne !== 'function') return null;
  return container.findOne<Konva.Line>(`.${ARROW_SHAFT_NODE_NAME}`) ?? null;
}

function resolveArrowHitboxNode(node: Konva.Node): Konva.Rect | null {
  const container = node as unknown as Container;
  if (typeof container.findOne !== 'function') return null;
  return container.findOne<Konva.Rect>(`.${ARROW_HITBOX_NODE_NAME}`) ?? null;
}

function resolveArrowHeadNode(node: Konva.Node, itemId: string): Konva.Line | null {
  if (typeof node.getLayer !== 'function') return null;
  return node.getLayer()?.findOne(`#${arrowHeadNodeId(itemId)}`) as Konva.Line | null;
}

export function updateArrowHeadNodeGeometry(node: Konva.Node, item: ArrowMark): void {
  resolveArrowHeadNode(node, item.id)?.points(resolveArrowHeadPoints(item));
}

/** 同步箭身、稳定命中框和固定尺寸箭头头部，不依赖 Konva.Arrow 的退化边界。 */
export function updateArrowNodeGeometry(node: Konva.Node, item: ArrowMark): void {
  const shaft = resolveArrowShaftNode(node);
  const hitbox = resolveArrowHitboxNode(node);
  const curved = Boolean(item.curveControl);
  shaft?.setAttrs({
    points: curved ? arrowToKonvaBezierPoints(item) : item.points,
    bezier: curved,
  });
  hitbox?.setAttrs(resolveArrowVisualBounds(item));
  updateArrowHeadNodeGeometry(node, item);
}
