import { z } from 'zod';
import { createDocumentGeometryCommandV3 } from '../documentGeometry';
import type { ImageEditDocumentV3 } from '../documentTypes';
import type { ImageEditCommandV3, ImageEditLeafCommandV3 } from '../commandTypes';
import type { ImageEditSmartLayerV3 } from '../smartContent/types';
import type { ImageEditSelectionSessionV3 } from '../selection/session';
import type { RegionSampleTime } from '../../../imaging/regions';
import { rectanglePath } from '../../../imaging/vectorContent';
import type { ImageEditLayerV3 } from '../layerTypes';
import { rebaseImageEditSelectionGridV3 } from '../selection/rebase';

/** 比例相对于原画幅；允许任意有限扩展，实际模型/编码器约束由执行端检查。 */
export const imageEditOutpaintMarginsSchemaV3 = z.object({ left: z.number().finite().nonnegative().optional(), top: z.number().finite().nonnegative().optional(), right: z.number().finite().nonnegative(), bottom: z.number().finite().nonnegative() }).strict()
  .refine(value => (value.left ?? 0) > 0 || (value.top ?? 0) > 0 || value.right > 0 || value.bottom > 0, '至少扩展一条边');
export type ImageEditOutpaintMarginsV3 = z.infer<typeof imageEditOutpaintMarginsSchemaV3>;
export interface ImageEditOutpaintPlanV3 {
  documentId: string; sourceVersion: number; time: RegionSampleTime;
  offset: { x: number; y: number };
  original: { width: number; height: number }; output: { width: number; height: number };
}
function assertImageEditOutpaintDocumentV3(document: ImageEditDocumentV3): void {
  if (document.geometry.crop || document.geometry.orientation.rotate || document.geometry.orientation.mirrored) throw new Error('扩图前请取消裁剪并恢复画面方向，原图会完整保留');
  if (document.color.workingSpace !== 'srgb' || document.color.hdrMetadata || !['srgb', 'linear'].includes(document.color.transferFunction)) throw new Error('扩图目前支持标准色域图片；宽色域与 HDR 的生成颜色尚未验证');
  const dependsOnCanvas = (layers: readonly ImageEditLayerV3[]): boolean => layers.some(layer => layer.visible && (
    layer.type === 'effect' || layer.type === 'adjustment' || layer.filters.some(filter => filter.enabled)
    || layer.type === 'group' && dependsOnCanvas(layer.children)));
  if (dependsOnCanvas(document.layers)) throw new Error('当前滤镜或效果依赖画幅尺寸；请先将处理后的内容嵌入智能对象保留外观，再扩图');
}
export function planImageEditOutpaintV3(document: ImageEditDocumentV3, margins: ImageEditOutpaintMarginsV3,
  time: RegionSampleTime = { kind: 'static' }): ImageEditOutpaintPlanV3 {
  const parsed = imageEditOutpaintMarginsSchemaV3.parse(margins);
  assertImageEditOutpaintDocumentV3(document);
  const original = { width: document.geometry.width, height: document.geometry.height };
  const offset = { x: Math.round(original.width * (parsed.left ?? 0)), y: Math.round(original.height * (parsed.top ?? 0)) };
  const output = { width: original.width + offset.x + Math.max(0, Math.round(original.width * parsed.right)), height: original.height + offset.y + Math.max(0, Math.round(original.height * parsed.bottom)) };
  if (![output.width, output.height].every(value => Number.isSafeInteger(value) && value > 0) || output.width === original.width && output.height === original.height) throw new Error('扩展尺寸必须增加至少一个像素，且不能超过整数坐标精度');
  return { documentId: document.id, sourceVersion: document.revision, time, original, output, offset };
}
export function rebaseImageEditSelectionForOutpaintV3(selection: ImageEditSelectionSessionV3, plan: ImageEditOutpaintPlanV3): ImageEditSelectionSessionV3 {
  return rebaseImageEditSelectionGridV3(selection, plan.original, plan.output, [1, 0, 0, 1, plan.offset.x, plan.offset.y]);
}
export function createImageEditOutpaintCommandV3(document: ImageEditDocumentV3, plan: ImageEditOutpaintPlanV3,
  layer: ImageEditSmartLayerV3, bytes: Readonly<Record<string, number>>, commandId: string): ImageEditCommandV3 {
  if (document.id !== plan.documentId || document.geometry.width !== plan.original.width || document.geometry.height !== plan.original.height) throw new Error('原画幅已变化，生成结果仍在历史中，请重新选择落点');
  assertImageEditOutpaintDocumentV3(document);
  const commands: ImageEditLeafCommandV3[] = [];
  type Draft<T> = T extends ImageEditLeafCommandV3 ? Omit<T, 'expectedRevision'> : never;
  const add = (command: Draft<ImageEditLeafCommandV3>): void => { commands.push({ ...command, expectedRevision: document.revision + commands.length } as ImageEditLeafCommandV3); };
  const geometry = createDocumentGeometryCommandV3(document, plan.output, [1, 0, 0, 1, plan.offset.x, plan.offset.y], `${commandId}:geometry`);
  if (geometry.type !== 'document.atomic') throw new Error('扩图几何事务无效');
  commands.push(...geometry.commands);
  const result = structuredClone(layer);
  // 新层只显示新增边缘；原画面像素、alpha 和所有编辑都从下方原图保持。
  result.mask = { kind: 'sparse-mask', storage: 'mask-float32', maskId: `${layer.id}:margin-mask`, tileSize: 512, defaultValue: 0, tiles: {}, inverted: false,
    vectorPaths: [{ operation: 'replace', path: rectanglePath(0, 0, plan.output.width, plan.output.height) },
      { operation: 'subtract', path: rectanglePath(plan.offset.x, plan.offset.y, plan.original.width, plan.original.height) }] };
  result.maskAttachment = { ...result.maskAttachment, linked: false };
  const resources = Object.entries(bytes).sort(([a], [b]) => a.localeCompare(b)).map(([resourceId, byteSize]) => ({ resourceId, byteSize }));
  add({ type: 'layer.add', commandId: `${commandId}:layer`, parentId: null, index: document.layers.length, layer: result, resources });
  return { type: 'document.atomic', commandId, expectedRevision: document.revision, commands };
}
