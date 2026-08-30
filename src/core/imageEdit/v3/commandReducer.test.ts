import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_TEXT_HEX } from '@/core/theme/colorTokens';
import {
  applyImageEditCommandV3,
  ImageEditCommandValidationErrorV3,
  ImageEditLayerLockedErrorV3,
  ImageEditRevisionConflictErrorV3,
} from './commandReducer';
import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditRasterLayerV3,
} from './documentFactory';
import type { ImageEditDocumentV3 } from './documentTypes';
import type { ImageEditLayerV3 } from './layerTypes';

function createDocument(layers: ImageEditLayerV3[]): ImageEditDocumentV3 {
  return { ...createImageEditDocumentV3({ width: 100, height: 80, documentId: 'document-1' }), layers };
}

describe('图片编辑 V3 命令归约器', () => {
  it('非破坏性更新方向与裁剪，并以一条逆向命令恢复', () => {
    const source = createDocument([createImageEditRasterLayerV3('source', '原图')]);
    const cropped = applyImageEditCommandV3(source, {
      commandId: 'crop',
      expectedRevision: 0,
      type: 'document.update-output-geometry',
      orientation: { rotate: 90, mirrored: true },
      crop: { x: 5, y: 10, width: 60, height: 80 },
    });

    expect(cropped.document.geometry).toEqual({
      width: 100,
      height: 80,
      orientation: { rotate: 90, mirrored: true },
      crop: { x: 5, y: 10, width: 60, height: 80 },
    });
    expect(cropped.document.layers).toBe(source.layers);
    const restored = applyImageEditCommandV3(cropped.document, cropped.inverse);
    expect(restored.document.geometry).toEqual(source.geometry);

    expect(() => applyImageEditCommandV3(source, {
      commandId: 'invalid-crop',
      expectedRevision: 0,
      type: 'document.update-output-geometry',
      orientation: { rotate: 0, mirrored: false },
      crop: { x: 90, y: 0, width: 20, height: 20 },
    })).toThrow(ImageEditCommandValidationErrorV3);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'unchanged-geometry',
      expectedRevision: 0,
      type: 'document.update-output-geometry',
      orientation: { rotate: 0, mirrored: false },
      crop: null,
    })).toThrow(ImageEditCommandValidationErrorV3);
  });

  it('把连续图层组成可逆嵌套组，且每次持久命令只增加一次 revision', () => {
    const raster = createImageEditRasterLayerV3('raster', '原图', 'sha256:source');
    const marks = createImageEditAnnotationLayerV3('marks', '标注');
    const paint = createImageEditRasterLayerV3('paint', '画笔');
    const source = createDocument([raster, marks, paint]);
    const group = createImageEditGroupLayerV3('group', '标注组');

    const grouped = applyImageEditCommandV3(source, {
      commandId: 'group-command',
      expectedRevision: 0,
      type: 'layer.group',
      layerIds: ['marks', 'paint'],
      group,
    });
    expect(grouped.document.revision).toBe(1);
    expect(grouped.document.layers.map((layer) => layer.id)).toEqual(['raster', 'group']);
    expect(grouped.document.layers[1]).toMatchObject({
      type: 'group',
      children: [{ id: 'marks' }, { id: 'paint' }],
    });

    const ungrouped = applyImageEditCommandV3(grouped.document, grouped.inverse);
    expect(ungrouped.document.revision).toBe(2);
    expect(ungrouped.document.layers.map((layer) => layer.id)).toEqual(['raster', 'marks', 'paint']);
  });

  it('拒绝修改锁定图层、移动到自身后代和过期 CAS', () => {
    const locked = { ...createImageEditAnnotationLayerV3('locked', '锁定标注'), locked: true };
    const nested = createImageEditGroupLayerV3('nested', '子组');
    const parent = { ...createImageEditGroupLayerV3('parent', '父组'), children: [nested] };
    const source = createDocument([locked, parent]);

    expect(() => applyImageEditCommandV3(source, {
      commandId: 'delete-locked', expectedRevision: 0, type: 'layer.delete', layerId: 'locked',
    })).toThrow(ImageEditLayerLockedErrorV3);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'cycle', expectedRevision: 0, type: 'layer.move', layerId: 'parent', parentId: 'nested', index: 0,
    })).toThrow(ImageEditCommandValidationErrorV3);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'stale', expectedRevision: 9, type: 'layer.delete', layerId: 'parent',
    })).toThrow(ImageEditRevisionConflictErrorV3);
  });

  it('支持深复制、公共属性、蒙版和标注 CRUD 的逆向补丁', () => {
    const marks = createImageEditAnnotationLayerV3('marks', '标注');
    const group = { ...createImageEditGroupLayerV3('group', '组'), children: [marks] };
    let document = createDocument([group]);
    const duplicated = applyImageEditCommandV3(document, {
      commandId: 'duplicate',
      expectedRevision: 0,
      type: 'layer.duplicate',
      layerId: 'group',
      parentId: null,
      index: 1,
      idMap: { group: 'group-copy', marks: 'marks-copy' },
    });
    expect(duplicated.document.layers[1]).toMatchObject({
      id: 'group-copy', children: [{ id: 'marks-copy' }],
    });

    document = applyImageEditCommandV3(duplicated.document, {
      commandId: 'opacity', expectedRevision: 1, type: 'layer.update-common', layerId: 'marks-copy', patch: { opacity: 0.4 },
    }).document;
    document = applyImageEditCommandV3(document, {
      commandId: 'mask', expectedRevision: 2, type: 'layer.set-mask', layerId: 'marks-copy', mask: { resourceId: 'sha256:mask', inverted: true },
    }).document;
    const added = applyImageEditCommandV3(document, {
      commandId: 'annotation',
      expectedRevision: 3,
      type: 'annotation.add',
      layerId: 'marks-copy',
      index: 0,
      annotation: { id: 'text', type: 'text', x: 1, y: 2, text: 'V3', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 20 },
    });
    const copy = (added.document.layers[1].type === 'group' ? added.document.layers[1].children[0] : null);
    expect(copy).toMatchObject({ opacity: 0.4, mask: { resourceId: 'sha256:mask', inverted: true } });
    expect(copy?.type === 'annotation' ? copy.annotations : []).toHaveLength(1);

    const removedAgain = applyImageEditCommandV3(added.document, added.inverse);
    const copyAfterUndo = removedAgain.document.layers[1].type === 'group'
      ? removedAgain.document.layers[1].children[0]
      : null;
    expect(copyAfterUndo?.type === 'annotation' ? copyAfterUndo.annotations : []).toEqual([]);
  });

  it('栅格瓦片增量只保存内容哈希，并能原子恢复旧哈希', () => {
    const raster = {
      ...createImageEditRasterLayerV3('paint', '画笔'),
      tiles: { '0/1/1': 'sha256:old' },
    };
    const source = createDocument([raster]);
    const applied = applyImageEditCommandV3(source, {
      commandId: 'stroke',
      expectedRevision: 0,
      type: 'raster.apply-tile-delta',
      layerId: 'paint',
      changes: [
        {
          tileKey: '0/1/1',
          previousResourceId: 'sha256:old',
          previousByteSize: 3_072,
          resourceId: 'sha256:new',
          byteSize: 2_048,
        },
        {
          tileKey: '0/1/2',
          previousResourceId: null,
          previousByteSize: 0,
          resourceId: 'sha256:next',
          byteSize: 1_024,
        },
      ],
    });
    expect(applied.document.layers[0]).toMatchObject({
      tiles: { '0/1/1': 'sha256:new', '0/1/2': 'sha256:next' },
    });
    expect(JSON.stringify(applied.inverse)).not.toContain('pixel');
    expect(applied.historyResources).toEqual([
      { resourceId: 'sha256:new', byteSize: 2_048 },
      { resourceId: 'sha256:next', byteSize: 1_024 },
      { resourceId: 'sha256:old', byteSize: 3_072 },
    ]);
    expect(applied.historyBytes).toBe(applied.historyMetadataBytes + 6_144);
    const restored = applyImageEditCommandV3(applied.document, applied.inverse);
    expect(restored.document.layers[0]).toMatchObject({ tiles: { '0/1/1': 'sha256:old' } });
  });

  it('拒绝瓦片旧哈希 CAS 不匹配、空操作和伪造旧字节数', () => {
    const raster = {
      ...createImageEditRasterLayerV3('paint', '画笔'),
      tiles: { '0/0/0': 'sha256:old' },
    };
    const source = createDocument([raster]);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'stale-tile', expectedRevision: 0, type: 'raster.apply-tile-delta', layerId: 'paint',
      changes: [{
        tileKey: '0/0/0', previousResourceId: 'sha256:other', previousByteSize: 1,
        resourceId: 'sha256:new', byteSize: 2,
      }],
    })).toThrow(ImageEditRevisionConflictErrorV3);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'noop-tile', expectedRevision: 0, type: 'raster.apply-tile-delta', layerId: 'paint',
      changes: [{
        tileKey: '0/0/0', previousResourceId: 'sha256:old', previousByteSize: 1,
        resourceId: 'sha256:old', byteSize: 1,
      }],
    })).toThrow(ImageEditCommandValidationErrorV3);
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'invalid-empty-size', expectedRevision: 0, type: 'raster.apply-tile-delta', layerId: 'paint',
      changes: [{
        tileKey: '0/0/0', previousResourceId: 'sha256:old', previousByteSize: 1,
        resourceId: null, byteSize: 99,
      }],
    })).toThrow(ImageEditCommandValidationErrorV3);
  });

  it('以单条可逆命令更新效果参数，并拒绝修改旧格式占位图层', () => {
    const blur = createImageEditEffectLayerV3('blur', '高斯模糊', 'gaussian-blur-v2', { radius: 8 });
    const legacy = createImageEditEffectLayerV3('legacy', '旧效果', 'legacy:unknown', { amount: 1 }, false);
    const source = createDocument([blur, legacy]);
    const updated = applyImageEditCommandV3(source, {
      commandId: 'blur-radius',
      expectedRevision: 0,
      type: 'layer.update-params',
      layerId: 'blur',
      params: { radius: 24, quality: 'stable' },
    });

    expect(updated.document.layers[0]).toMatchObject({ params: { radius: 24, quality: 'stable' } });
    const restored = applyImageEditCommandV3(updated.document, updated.inverse);
    expect(restored.document.layers[0]).toMatchObject({ params: { radius: 8 } });
    expect(() => applyImageEditCommandV3(source, {
      commandId: 'legacy-params',
      expectedRevision: 0,
      type: 'layer.update-params',
      layerId: 'legacy',
      params: { amount: 2 },
    })).toThrow(ImageEditCommandValidationErrorV3);
  });

  it('以可逆命令切换图层组的隔离与穿透语义', () => {
    const source = createDocument([createImageEditGroupLayerV3('group', '组')]);
    const isolated = applyImageEditCommandV3(source, {
      commandId: 'isolate-group',
      expectedRevision: 0,
      type: 'group.update-isolation',
      layerId: 'group',
      isolated: true,
    });
    expect(isolated.document.layers[0]).toMatchObject({ type: 'group', isolated: true });
    const restored = applyImageEditCommandV3(isolated.document, isolated.inverse);
    expect(restored.document.layers[0]).toMatchObject({ type: 'group', isolated: false });
  });
});
