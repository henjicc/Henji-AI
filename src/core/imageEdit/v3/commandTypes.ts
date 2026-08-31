import type { MarkItem } from '../types';
import type {
  ImageEditCropRectV3,
  ImageEditDocumentV3,
  ImageEditOrientationV3,
} from './documentTypes';
import type {
  ImageEditBlendModeV3,
  ImageEditGroupLayerV3,
  ImageEditLayerV3,
  ImageEditMaskReferenceV3,
  ImageEditJsonObjectV3,
  ImageEditTransformV3,
} from './layerTypes';
import { collectImageEditMaskResourceIdsV3 } from './layerTypes';

export interface ImageEditCommandBaseV3 {
  commandId: string;
  expectedRevision: number;
}

export interface ImageEditDocumentUpdateOutputGeometryCommandV3 extends ImageEditCommandBaseV3 {
  type: 'document.update-output-geometry';
  orientation: ImageEditOrientationV3;
  crop: ImageEditCropRectV3 | null;
}

export type ImageEditLayerCommonPatchV3 = Partial<{
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: ImageEditBlendModeV3;
  transform: ImageEditTransformV3;
}>;

export interface ImageEditLayerAddCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.add';
  parentId: string | null;
  index: number;
  layer: ImageEditLayerV3;
}

export interface ImageEditLayerDeleteCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.delete';
  layerId: string;
}

export interface ImageEditLayerMoveCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.move';
  layerId: string;
  parentId: string | null;
  /** 从原容器移除后，在目标容器最终数组中的位置。 */
  index: number;
}

export interface ImageEditLayerDuplicateCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.duplicate';
  layerId: string;
  parentId: string | null;
  index: number;
  /** 原图层 ID → 副本 ID，组内每个后代都必须有映射。 */
  idMap: Record<string, string>;
}

export interface ImageEditLayerGroupCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.group';
  /** 必须是同一容器中连续的图层；按原有顺序进入组。 */
  layerIds: string[];
  group: ImageEditGroupLayerV3;
}

export interface ImageEditLayerUngroupCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.ungroup';
  groupId: string;
}

export interface ImageEditLayerUpdateCommonCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.update-common';
  layerId: string;
  patch: ImageEditLayerCommonPatchV3;
}

export interface ImageEditLayerSetMaskCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.set-mask';
  layerId: string;
  mask: ImageEditMaskReferenceV3 | null;
}

export interface ImageEditLayerUpdateParamsCommandV3 extends ImageEditCommandBaseV3 {
  type: 'layer.update-params';
  layerId: string;
  params: ImageEditJsonObjectV3;
}

export interface ImageEditGroupUpdateIsolationCommandV3 extends ImageEditCommandBaseV3 {
  type: 'group.update-isolation';
  layerId: string;
  isolated: boolean;
}

export interface ImageEditAnnotationAddCommandV3 extends ImageEditCommandBaseV3 {
  type: 'annotation.add';
  layerId: string;
  index: number;
  annotation: MarkItem;
}

export interface ImageEditAnnotationUpdateCommandV3 extends ImageEditCommandBaseV3 {
  type: 'annotation.update';
  layerId: string;
  annotationId: string;
  annotation: MarkItem;
}

export interface ImageEditAnnotationDeleteCommandV3 extends ImageEditCommandBaseV3 {
  type: 'annotation.delete';
  layerId: string;
  annotationId: string;
}

export interface ImageEditRasterTileChangeV3 {
  tileKey: string;
  /** 应用命令前的瓦片资源；用于校验 CAS 与保留撤销资源。 */
  previousResourceId: string | null;
  /** previousResourceId 为 null 时必须为 0。 */
  previousByteSize: number;
  /** null 表示删除稀疏覆盖，露出图层 source。 */
  resourceId: string | null;
  /** resourceId 为 null 时必须为 0；否则为不可变资源的实际字节数。 */
  byteSize: number;
}

export interface ImageEditRasterTileDeltaCommandV3 extends ImageEditCommandBaseV3 {
  type: 'raster.apply-tile-delta';
  layerId: string;
  changes: ImageEditRasterTileChangeV3[];
}

export interface ImageEditMaskTileDeltaCommandV3 extends ImageEditCommandBaseV3 {
  type: 'mask.apply-tile-delta';
  layerId: string;
  /** 必须与命令起始 revision 中的稀疏蒙版一致，防止删除/替换蒙版后误写。 */
  maskId: string;
  changes: ImageEditRasterTileChangeV3[];
}

export type ImageEditCommandV3 =
  | ImageEditDocumentUpdateOutputGeometryCommandV3
  | ImageEditLayerAddCommandV3
  | ImageEditLayerDeleteCommandV3
  | ImageEditLayerMoveCommandV3
  | ImageEditLayerDuplicateCommandV3
  | ImageEditLayerGroupCommandV3
  | ImageEditLayerUngroupCommandV3
  | ImageEditLayerUpdateCommonCommandV3
  | ImageEditLayerUpdateParamsCommandV3
  | ImageEditGroupUpdateIsolationCommandV3
  | ImageEditLayerSetMaskCommandV3
  | ImageEditAnnotationAddCommandV3
  | ImageEditAnnotationUpdateCommandV3
  | ImageEditAnnotationDeleteCommandV3
  | ImageEditRasterTileDeltaCommandV3
  | ImageEditMaskTileDeltaCommandV3;

export interface ImageEditCommandApplyResultV3 {
  document: ImageEditDocumentV3;
  inverse: ImageEditCommandV3;
  historyMetadataBytes: number;
  historyResources: ImageEditHistoryResourceReferenceV3[];
  historyBytes: number;
}

/** null 字节数表示命令引用了资源，但当前文档格式没有保存其大小。 */
export interface ImageEditHistoryResourceReferenceV3 {
  resourceId: string;
  byteSize: number | null;
}

function collectLayerResources(
  layer: ImageEditLayerV3,
  output: ImageEditHistoryResourceReferenceV3[],
): void {
  if (layer.mask) {
    collectImageEditMaskResourceIdsV3(layer.mask).forEach((resourceId) => {
      output.push({ resourceId, byteSize: null });
    });
  }
  if (layer.type === 'raster') {
    if (layer.source.kind === 'resource') {
      output.push({ resourceId: layer.source.resourceId, byteSize: null });
    }
    for (const resourceId of Object.values(layer.tiles)) {
      output.push({ resourceId, byteSize: null });
    }
  } else if (layer.type === 'group') {
    layer.children.forEach((child) => collectLayerResources(child, output));
  }
}

/** 枚举命令本身持有的权威资源引用；不会读取文档或像素。 */
export function collectImageEditCommandResourceReferencesV3(
  command: ImageEditCommandV3,
): ImageEditHistoryResourceReferenceV3[] {
  const resources: ImageEditHistoryResourceReferenceV3[] = [];
  if (command.type === 'raster.apply-tile-delta' || command.type === 'mask.apply-tile-delta') {
    for (const change of command.changes) {
      if (change.previousResourceId) {
        resources.push({ resourceId: change.previousResourceId, byteSize: change.previousByteSize });
      }
      if (change.resourceId) {
        resources.push({ resourceId: change.resourceId, byteSize: change.byteSize });
      }
    }
  } else if (command.type === 'layer.add') {
    collectLayerResources(command.layer, resources);
  } else if (command.type === 'layer.group') {
    collectLayerResources(command.group, resources);
  } else if (command.type === 'layer.set-mask' && command.mask) {
    collectImageEditMaskResourceIdsV3(command.mask).forEach((resourceId) => {
      resources.push({ resourceId, byteSize: null });
    });
  }
  return resources;
}

export function mergeImageEditHistoryResourceReferencesV3(
  resources: readonly ImageEditHistoryResourceReferenceV3[],
): ImageEditHistoryResourceReferenceV3[] {
  const byId = new Map<string, number | null>();
  for (const resource of resources) {
    if (!resource.resourceId || resource.resourceId.length > 512
      || (resource.byteSize !== null
        && (!Number.isSafeInteger(resource.byteSize) || resource.byteSize < 0))) {
      throw new Error('图片编辑历史资源引用无效');
    }
    const existing = byId.get(resource.resourceId);
    if (existing !== undefined && existing !== null
      && resource.byteSize !== null && existing !== resource.byteSize) {
      throw new Error(`图片编辑历史资源字节数冲突：${resource.resourceId}`);
    }
    byId.set(resource.resourceId, existing ?? resource.byteSize);
  }
  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, byteSize]) => ({ resourceId, byteSize }));
}

export function withImageEditCommandRevisionV3(
  command: ImageEditCommandV3,
  expectedRevision: number
): ImageEditCommandV3 {
  return { ...command, expectedRevision };
}
