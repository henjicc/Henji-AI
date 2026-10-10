import type { RichTextContent, VectorPathContent } from '../../../imaging/vectorContent';
import { richTextContentSchema, vectorPathContentSchema, defaultTextStyle, rectanglePath } from '../../../imaging/vectorContent';
import { createImageEditLayerCommonV3, type ImageEditLayerCommonV3 } from '../layerTypes';

export interface ImageEditTextLayerV3 extends ImageEditLayerCommonV3 { type: 'text'; content: RichTextContent }
export interface ImageEditShapeLayerV3 extends ImageEditLayerCommonV3 { type: 'shape'; content: VectorPathContent }
export interface ImageEditPathLayerV3 extends ImageEditLayerCommonV3 { type: 'path'; content: VectorPathContent }
export type ImageEditVectorLayerV3 = ImageEditTextLayerV3 | ImageEditShapeLayerV3 | ImageEditPathLayerV3;

export function isImageEditVectorLayerV3(layer: { type: string }): layer is ImageEditVectorLayerV3 {
  return layer.type === 'text' || layer.type === 'shape' || layer.type === 'path';
}
export function parseImageEditVectorContentV3(type: ImageEditVectorLayerV3['type'], value: unknown): RichTextContent | VectorPathContent {
  return type === 'text' ? richTextContentSchema.parse(value) : vectorPathContentSchema.parse(value);
}
export function createImageEditTextLayerV3(id: string, name: string, content?: RichTextContent): ImageEditTextLayerV3 {
  const style = defaultTextStyle(720);
  return { ...createImageEditLayerCommonV3(id, name), type: 'text', content: content ?? { paragraphs: [{ runs: [{ text: '文字', style }], align: 'left', direction: 'auto', spaceBefore: 0, spaceAfter: 0 }], box: { x: 0, y: 0, width: 0, height: 0 } } };
}
export function createImageEditPathLayerV3(id: string, name: string, type: 'shape' | 'path' = 'shape', content?: VectorPathContent): ImageEditShapeLayerV3 | ImageEditPathLayerV3 {
  const style = defaultTextStyle(720);
  return { ...createImageEditLayerCommonV3(id, name), type, content: content ?? { operands: [{ path: rectanglePath(0, 0, 160, 100), operation: 'replace' }], paint: { fill: style.fill, strokes: [], shadows: [] } } };
}
