import { z } from 'zod';
import { composeAffine, type Affine } from '../../../imaging/transforms';
import type { ImageEditDocumentV3 } from '../documentTypes';
import type { ImageEditCommandV3, ImageEditLeafCommandV3 } from '../commandTypes';
import type { ImageEditLayerV3 } from '../layerTypes';
import { rebaseImageEditSelectionGridV3 } from '../selection/rebase';

export const canvasAnchorSchemaV3 = z.enum(['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']);
export type CanvasAnchorV3 = z.infer<typeof canvasAnchorSchemaV3>;
export const documentSizeSchemaV3 = z.object({ width: z.number().int().positive().safe(), height: z.number().int().positive().safe() }).strict();
export const canvasSizeSchemaV3 = documentSizeSchemaV3.extend({ anchor: canvasAnchorSchemaV3 });
export function canvasSizeTransformV3(original: { width: number; height: number }, output: { width: number; height: number }, anchor: CanvasAnchorV3): Affine {
  documentSizeSchemaV3.parse(output); canvasAnchorSchemaV3.parse(anchor);
  const x = anchor.includes('left') || anchor === 'left' ? 0 : anchor.includes('right') || anchor === 'right' ? 1 : .5;
  const y = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : .5;
  return [1, 0, 0, 1, Math.round((output.width - original.width) * x) || 0, Math.round((output.height - original.height) * y) || 0];
}
export function documentNeedsGeometryAppearanceV3(document: ImageEditDocumentV3): boolean {
  const visit = (layers: readonly ImageEditLayerV3[]): boolean => layers.some(layer => layer.type === 'effect' || layer.type === 'adjustment'
    || layer.filters.length > 0 || layer.type === 'group' && visit(layer.children));
  return visit(document.layers);
}
/** Compose existing finite leaf commands; no second document/history format. */
export function createDocumentGeometryCommandV3(document: ImageEditDocumentV3, output: { width: number; height: number }, transform: Affine,
  commandId: string, replacement?: ImageEditLayerV3): ImageEditCommandV3 {
  documentSizeSchemaV3.parse(output);
  if (output.width === document.geometry.width && output.height === document.geometry.height) throw new Error('尺寸没有变化');
  const commands: ImageEditLeafCommandV3[] = [];
  type Draft<T> = T extends ImageEditLeafCommandV3 ? Omit<T, 'expectedRevision'> : never;
  const add = (command: Draft<ImageEditLeafCommandV3>): void => { commands.push({ ...command, expectedRevision: document.revision + commands.length } as ImageEditLeafCommandV3); };
  if (document.geometry.crop) add({ type: 'document.update-output-geometry', commandId: `${commandId}:crop`, orientation: document.geometry.orientation, crop: null });
  const canvases: Record<string, { width: number; height: number } | null> = {};
  const visit = (layers: readonly ImageEditLayerV3[]): void => { for (const layer of layers) {
    if (layer.type === 'group') visit(layer.children);
    else if (layer.type === 'raster' && !layer.rasterCanvasSize) canvases[layer.id] = { width: document.geometry.width, height: document.geometry.height };
  } }; visit(document.layers);
  add({ type: 'document.set-canvas-size', commandId: `${commandId}:size`, ...output, rasterCanvases: canvases });
  for (const layer of document.layers) if (layer.locked) add({ type: 'layer.update-common', commandId: `${commandId}:unlock:${layer.id}`, layerId: layer.id, patch: { locked: false } });
  if (replacement) {
    // Delete clipping runs from the top; bases can never be left with a dangling clip.
    for (const layer of [...document.layers].reverse()) add({ type: 'layer.delete', commandId: `${commandId}:remove:${layer.id}`, layerId: layer.id });
    add({ type: 'layer.add', commandId: `${commandId}:result`, parentId: null, index: 0, layer: replacement });
  } else {
    for (const layer of document.layers) add({ type: 'layer.update-common', commandId: `${commandId}:move:${layer.id}`, layerId: layer.id,
      patch: { transform: composeAffine(transform, layer.transform), ...(!layer.maskAttachment.linked ? { maskAttachment: { ...layer.maskAttachment, transform: composeAffine(transform, layer.maskAttachment.transform) } } : {}) } });
    for (const layer of document.layers) if (layer.locked) add({ type: 'layer.update-common', commandId: `${commandId}:lock:${layer.id}`, layerId: layer.id, patch: { locked: true } });
  }
  if (document.namedRegions.length) add({ type: 'document.set-named-regions', commandId: `${commandId}:regions`, regions: document.namedRegions.map(region => ({ ...region,
    selection: rebaseImageEditSelectionGridV3(region.selection, document.geometry, output, transform) })) });
  return { type: 'document.atomic', commandId, expectedRevision: document.revision, commands };
}
