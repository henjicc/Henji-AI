import type Konva from 'konva';
import {
  applyPointMarkTransform,
  getPointsBounds,
  updateMarkPosition,
  updateMarkTransform,
} from '../domain/geometry';
import type { MarkItem } from '../domain/types';
import { arrowBoundsPoints } from '../domain/arrowGeometry';
import { penBoundsPoints } from '../domain/penGeometry';
import { updateArrowNodeGeometry } from './arrowNodes';

/** 拖拽结束:把 Konva 节点位置写回标记项(处理各类型锚点差异) */
export function applyNodeDragToMark(item: MarkItem, node: Konva.Node): MarkItem {
  const nodeX = node.x();
  const nodeY = node.y();

  if (item.type === 'arrow' || item.type === 'pen') {
    const boundsPoints = item.type === 'arrow' ? arrowBoundsPoints(item) : penBoundsPoints(item.points);
    const { minX, minY } = getPointsBounds(boundsPoints);
    const updated = updateMarkPosition(item, minX + nodeX, minY + nodeY);
    node.x(0);
    node.y(0);
    if (updated.type === 'arrow') {
      updateArrowNodeGeometry(node, updated);
    }
    return updated;
  }

  if (item.type === 'ellipse') {
    return { ...item, x: nodeX - item.width / 2, y: nodeY - item.height / 2 };
  }

  // rect/text/mosaic 锚点为左上角;number 的 x/y 即圆心,节点原点也在圆心
  return { ...item, x: nodeX, y: nodeY };
}

/** 变换结束:把缩放折算进尺寸/字号并复位节点 scale */
export function applyNodeTransformToMark(item: MarkItem, node: Konva.Node): MarkItem {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const nodeX = node.x();
  const nodeY = node.y();

  if (item.type === 'arrow' || item.type === 'pen') {
    const updated = applyPointMarkTransform(item, nodeX, nodeY, scaleX, scaleY);
    node.scaleX(1);
    node.scaleY(1);
    node.x(0);
    node.y(0);
    if (updated.type === 'arrow') {
      updateArrowNodeGeometry(node, updated);
    }
    return updated;
  }

  node.scaleX(1);
  node.scaleY(1);

  if (item.type === 'ellipse') {
    const width = Math.max(5, item.width * scaleX);
    const height = Math.max(5, item.height * scaleY);
    return { ...item, x: nodeX - width / 2, y: nodeY - height / 2, width, height };
  }

  return updateMarkTransform(item, nodeX, nodeY, scaleX, scaleY);
}
