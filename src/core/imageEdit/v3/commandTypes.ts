import type { MarkItem } from '../types';
import type { ImageEditDocumentV3 } from './documentTypes';
import type {
  ImageEditBlendModeV3,
  ImageEditGroupLayerV3,
  ImageEditLayerV3,
  ImageEditMaskReferenceV3,
  ImageEditJsonObjectV3,
  ImageEditTransformV3,
} from './layerTypes';

export interface ImageEditCommandBaseV3 {
  commandId: string;
  expectedRevision: number;
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
  /** null 表示删除稀疏覆盖，露出图层 source。 */
  resourceId: string | null;
  /** 此次不可变瓦片增量的实际字节数，仅用于历史预算，不内嵌像素。 */
  byteSize: number;
}

export interface ImageEditRasterTileDeltaCommandV3 extends ImageEditCommandBaseV3 {
  type: 'raster.apply-tile-delta';
  layerId: string;
  changes: ImageEditRasterTileChangeV3[];
}

export type ImageEditCommandV3 =
  | ImageEditLayerAddCommandV3
  | ImageEditLayerDeleteCommandV3
  | ImageEditLayerMoveCommandV3
  | ImageEditLayerDuplicateCommandV3
  | ImageEditLayerGroupCommandV3
  | ImageEditLayerUngroupCommandV3
  | ImageEditLayerUpdateCommonCommandV3
  | ImageEditLayerUpdateParamsCommandV3
  | ImageEditLayerSetMaskCommandV3
  | ImageEditAnnotationAddCommandV3
  | ImageEditAnnotationUpdateCommandV3
  | ImageEditAnnotationDeleteCommandV3
  | ImageEditRasterTileDeltaCommandV3;

export interface ImageEditCommandApplyResultV3 {
  document: ImageEditDocumentV3;
  inverse: ImageEditCommandV3;
  historyBytes: number;
}

export function withImageEditCommandRevisionV3(
  command: ImageEditCommandV3,
  expectedRevision: number
): ImageEditCommandV3 {
  return { ...command, expectedRevision };
}
