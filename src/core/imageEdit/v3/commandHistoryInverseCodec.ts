import type { ImageEditCommandV3 } from './commandTypes';

export class ImageEditHistoryInversePairErrorV3 extends Error {}

function fail(message: string): never {
  throw new ImageEditHistoryInversePairErrorV3(message);
}

/** 校验历史 forward/inverse 的结构对应关系；资源内容本身由命令 codec 单独校验。 */
export function assertImageEditHistoryInversePairV3(
  forward: ImageEditCommandV3,
  inverse: ImageEditCommandV3,
): void {
  if (inverse.commandId !== `${forward.commandId}:inverse`
    || inverse.expectedRevision !== forward.expectedRevision + 1) fail('历史逆向补丁基线无效');
  switch (forward.type) {
    case 'document.update-output-geometry':
      if (inverse.type !== 'document.update-output-geometry') fail('图片输出几何逆向补丁无效'); break;
    case 'layer.add':
      if (inverse.type !== 'layer.delete' || inverse.layerId !== forward.layer.id) fail('新增图层逆向补丁无效'); break;
    case 'layer.delete':
      if (inverse.type !== 'layer.add' || inverse.layer.id !== forward.layerId) fail('删除图层逆向补丁无效'); break;
    case 'layer.move':
      if (inverse.type !== 'layer.move' || inverse.layerId !== forward.layerId) fail('移动图层逆向补丁无效'); break;
    case 'layer.duplicate': {
      const duplicateId = forward.idMap[forward.layerId];
      if (!duplicateId || inverse.type !== 'layer.delete' || inverse.layerId !== duplicateId) fail('复制图层逆向补丁无效');
      break;
    }
    case 'layer.group':
      if (inverse.type !== 'layer.ungroup' || inverse.groupId !== forward.group.id) fail('图层分组逆向补丁无效'); break;
    case 'layer.ungroup':
      if (inverse.type !== 'layer.group' || inverse.group.id !== forward.groupId) fail('图层解组逆向补丁无效'); break;
    case 'layer.update-common':
      if (inverse.type !== 'layer.update-common' || inverse.layerId !== forward.layerId) fail('图层属性逆向补丁无效'); break;
    case 'layer.update-params':
      if (inverse.type !== 'layer.update-params' || inverse.layerId !== forward.layerId) fail('图层参数逆向补丁无效'); break;
    case 'group.update-isolation':
      if (inverse.type !== 'group.update-isolation' || inverse.layerId !== forward.layerId) fail('图层组逆向补丁无效'); break;
    case 'layer.set-mask': {
      if (inverse.type !== 'layer.set-mask' || inverse.layerId !== forward.layerId) {
        fail('图层蒙版逆向补丁无效');
      }
      const forwardStrict = forward.maskResources !== undefined
        || forward.previousMaskResources !== undefined;
      const inverseStrict = inverse.maskResources !== undefined
        || inverse.previousMaskResources !== undefined;
      if (forwardStrict !== inverseStrict) fail('图层蒙版资源逆向补丁缺失');
      if (forwardStrict && (
        JSON.stringify(forward.maskResources) !== JSON.stringify(inverse.previousMaskResources)
        || JSON.stringify(forward.previousMaskResources) !== JSON.stringify(inverse.maskResources)
      )) fail('图层蒙版资源逆向补丁无效');
      break;
    }
    case 'annotation.add':
      if (inverse.type !== 'annotation.delete' || inverse.layerId !== forward.layerId
        || inverse.annotationId !== forward.annotation.id) fail('新增标注逆向补丁无效'); break;
    case 'annotation.delete':
      if (inverse.type !== 'annotation.add' || inverse.layerId !== forward.layerId
        || inverse.annotation.id !== forward.annotationId) fail('删除标注逆向补丁无效'); break;
    case 'annotation.update':
      if (inverse.type !== 'annotation.update' || inverse.layerId !== forward.layerId
        || inverse.annotationId !== forward.annotationId) fail('更新标注逆向补丁无效'); break;
    case 'raster.apply-tile-delta': {
      if (inverse.type !== 'raster.apply-tile-delta' || inverse.layerId !== forward.layerId
        || inverse.changes.length !== forward.changes.length) fail('瓦片增量逆向补丁无效');
      const inverseByKey = new Map(inverse.changes.map((change) => [change.tileKey, change]));
      for (const change of forward.changes) {
        const reversed = inverseByKey.get(change.tileKey);
        if (!reversed
          || reversed.previousResourceId !== change.resourceId
          || reversed.previousByteSize !== change.byteSize
          || reversed.resourceId !== change.previousResourceId
          || reversed.byteSize !== change.previousByteSize) fail('瓦片增量逆向资源不匹配');
      }
      break;
    }
    case 'mask.apply-tile-delta': {
      if (inverse.type !== 'mask.apply-tile-delta'
        || inverse.layerId !== forward.layerId
        || inverse.maskId !== forward.maskId
        || inverse.changes.length !== forward.changes.length) fail('蒙版瓦片增量逆向补丁无效');
      const inverseByKey = new Map(inverse.changes.map((change) => [change.tileKey, change]));
      for (const change of forward.changes) {
        const reversed = inverseByKey.get(change.tileKey);
        if (!reversed
          || reversed.previousResourceId !== change.resourceId
          || reversed.previousByteSize !== change.byteSize
          || reversed.resourceId !== change.previousResourceId
          || reversed.byteSize !== change.previousByteSize) fail('蒙版瓦片增量逆向资源不匹配');
      }
      break;
    }
  }
}
