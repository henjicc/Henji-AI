import type { ImageEditCommandV3 } from './commandTypes';

export class ImageEditHistoryInversePairErrorV3 extends Error {}

function fail(message: string): never {
  throw new ImageEditHistoryInversePairErrorV3(message);
}

function assertStructuralResourcesMatch(
  forward: { resources?: readonly unknown[] },
  inverse: { resources?: readonly unknown[] },
): void {
  const forwardStrict = forward.resources !== undefined
  const inverseStrict = inverse.resources !== undefined
  if (forwardStrict !== inverseStrict) fail('图层命令资源逆向补丁缺失')
  if (forwardStrict && JSON.stringify(forward.resources) !== JSON.stringify(inverse.resources)) {
    fail('图层命令资源逆向补丁无效')
  }
}

/** 校验历史 forward/inverse 的结构对应关系；资源内容本身由命令 codec 单独校验。 */
export function assertImageEditHistoryInversePairV3(
  forward: ImageEditCommandV3,
  inverse: ImageEditCommandV3,
): void {
  if (inverse.commandId !== `${forward.commandId}:inverse`
    || inverse.expectedRevision !== forward.expectedRevision + 1) fail('历史逆向补丁基线无效');
  switch (forward.type) {
    case 'document.set-canvas-size':
      if (inverse.type !== forward.type) fail('画布尺寸逆向补丁无效'); break;
    case 'layer.replace':
      if (inverse.type !== 'layer.replace' || inverse.layerId !== forward.layerId
        || inverse.layer.id !== forward.layer.id
        || JSON.stringify(inverse.resources) !== JSON.stringify(forward.resources)) fail('内容替换逆向补丁无效');
      break;
    case 'document.atomic':
      if (inverse.type !== 'document.atomic' || inverse.commands.length !== forward.commands.length) fail('原子历史逆向补丁无效');
      forward.commands.forEach((child, index) => assertImageEditHistoryInversePairV3(child, inverse.commands[inverse.commands.length - 1 - index]));
      break;
    case 'document.set-named-regions':
      if (inverse.type !== forward.type) fail('通道逆向补丁无效'); break;
    case 'layer.move-many':
      if (inverse.type !== forward.type || forward.moves.map(move => move.layerId).sort().join('\0')
        !== inverse.moves.map(move => move.layerId).sort().join('\0')) fail('多图层移动逆向补丁无效'); break;
    case 'document.update-output-geometry':
      if (inverse.type !== 'document.update-output-geometry') fail('图片输出几何逆向补丁无效'); break;
    case 'layer.add':
      if (inverse.type !== 'layer.delete' || inverse.layerId !== forward.layer.id) fail('新增图层逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse); break;
    case 'layer.delete':
      if (inverse.type !== 'layer.add' || inverse.layer.id !== forward.layerId) fail('删除图层逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse); break;
    case 'layer.move':
      if (inverse.type !== 'layer.move' || inverse.layerId !== forward.layerId) fail('移动图层逆向补丁无效'); break;
    case 'layer.duplicate': {
      const duplicateId = forward.idMap[forward.layerId];
      if (!duplicateId || inverse.type !== 'layer.delete' || inverse.layerId !== duplicateId) fail('复制图层逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse);
      break;
    }
    case 'layer.group':
      if (inverse.type !== 'layer.ungroup' || inverse.groupId !== forward.group.id) fail('图层分组逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse); break;
    case 'layer.ungroup':
      if (inverse.type !== 'layer.group' || inverse.group.id !== forward.groupId) fail('图层解组逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse); break;
    case 'layer.update-common':
      if (inverse.type !== 'layer.update-common' || inverse.layerId !== forward.layerId) fail('图层属性逆向补丁无效');
      assertStructuralResourcesMatch(forward, inverse);
      if (Object.keys(forward.patch).sort().join() !== Object.keys(inverse.patch).sort().join()) fail('图层属性逆向字段不匹配');
      break;
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
