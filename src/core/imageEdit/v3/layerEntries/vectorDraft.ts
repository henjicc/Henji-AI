import type { MarkItem } from '../../types';
import { defaultTextStyle, arrowPath, ellipsePath, rectanglePath, polylinePath, type VectorPath } from '../../../imaging/vectorContent';
import { createImageEditTextLayerV3, createImageEditPathLayerV3, type ImageEditVectorLayerV3 } from './vector';

/** Pointer/mark-operation drafts are transient; the document only contains formal content. */
export function imageEditLayersFromMarkDraftV3(item: MarkItem, number = 1): ImageEditVectorLayerV3[] {
  const style = defaultTextStyle(720);
  if (item.type === 'text' || item.type === 'number') {
    style.fontSize = item.fontSize; style.fill.color = item.color;
    style.align = 'left'; style.verticalAlign = 'top';
    if (item.type === 'text' && item.backgroundColor) style.background = { ...style.background, enabled: true, color: item.backgroundColor };
    const text = item.type === 'text' ? item.text : String(number);
    return [createImageEditTextLayerV3(item.id, text || '文字', { paragraphs: [{ runs: [{ text, style }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 0 }], box: { x: item.x, y: item.y - item.fontSize, width: 0, height: 0 } })];
  }
  let path: VectorPath;
  if (item.type === 'rect') path = rectanglePath(item.x, item.y, item.width, item.height);
  else if (item.type === 'ellipse') path = ellipsePath(item.x, item.y, item.width, item.height);
  else if (item.type === 'arrow') path = arrowPath({ x: item.points[0], y: item.points[1] }, { x: item.points[2], y: item.points[3] }, item.lineWidth, item.curveControl ? { x: item.curveControl[0], y: item.curveControl[1] } : undefined);
  else path = polylinePath(item.points.reduce<Array<{ x: number; y: number }>>((points, value, index) => { if (!(index % 2)) points.push({ x: value, y: item.points[index + 1] }); return points; }, []));
  const shape = createImageEditPathLayerV3(item.id, item.type === 'arrow' ? '箭头' : item.type === 'pen' ? '路径' : item.type === 'rect' ? '矩形' : '椭圆', item.type === 'pen' ? 'path' : 'shape', { operands: [{ path, operation: 'replace' }], paint: { fill: { enabled: false, color: item.stroke }, strokes: [{ enabled: true, color: item.stroke, width: item.lineWidth, position: 'center' }], shadows: [] } });
  const result: ImageEditVectorLayerV3[] = [shape];
  if ('label' in item && item.label) {
    const start = item.type === 'arrow' ? { x: item.points[2], y: item.points[3] } : { x: item.x + item.width / 2, y: item.y + item.height / 2 };
    const label = imageEditLayersFromMarkDraftV3({ id: `${item.id}:label`, type: 'text', text: item.label, x: start.x + (item.labelDx ?? 0), y: start.y + (item.labelDy ?? 0), fontSize: item.labelFontSize ?? style.fontSize, color: item.stroke, ...(item.labelBackgroundColor ? { backgroundColor: item.labelBackgroundColor } : {}) })[0];
    result.push(label);
  }
  return result;
}
