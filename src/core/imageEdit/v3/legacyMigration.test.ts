import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_TEXT_HEX } from '@/core/theme/colorTokens';
import { createDefaultBlurOperationParams } from '../blurParams';
import { createDefaultDiffusionOperationParams } from '../diffusionParams';
import {
  IMAGE_EDIT_DOCUMENT_VERSION,
  IMAGE_EDIT_OPERATION_IDS,
  type ImageEditDocument,
} from '../types';
import { decodeImageEditDocumentV3, stringifyImageEditDocumentV3 } from './documentCodec';
import { migrateImageEditDocumentV2ToV3 } from './legacyMigration';

function createV2Document(): ImageEditDocument {
  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION,
    operations: [{
      id: 'orientation',
      operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
      enabled: true,
      params: { rotate: 90, mirrored: true },
    }, {
      id: 'blur',
      operationId: IMAGE_EDIT_OPERATION_IDS.blur,
      enabled: true,
      params: createDefaultBlurOperationParams(),
    }, {
      id: 'annotations',
      operationId: IMAGE_EDIT_OPERATION_IDS.annotations,
      enabled: true,
      params: { items: [{ id: 'text-1', type: 'text', x: 10, y: 20, text: 'A', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 28 }] },
    }, {
      id: 'future',
      operationId: 'vendor.future-effect',
      enabled: true,
      params: { schemaVersion: 9, strength: 0.6, flags: ['x', 'y'] },
    }, {
      id: 'diffusion',
      operationId: IMAGE_EDIT_OPERATION_IDS.diffusion,
      enabled: false,
      params: createDefaultDiffusionOperationParams(),
    }, {
      id: 'crop',
      operationId: IMAGE_EDIT_OPERATION_IDS.crop,
      enabled: true,
      params: { rect: { x: 4, y: 6, width: 80, height: 60 } },
    }],
  };
}

describe('图片编辑 V2 → V3 迁移', () => {
  it('把几何移到文档根，并锁定原图→效果→标注的真实像素顺序', () => {
    const migrated = migrateImageEditDocumentV2ToV3(createV2Document(), {
      width: 100,
      height: 120,
      sourceResourceId: 'sha256:source',
      documentId: 'document-migrated',
    });

    expect(migrated.geometry).toEqual({
      width: 100,
      height: 120,
      orientation: { rotate: 90, mirrored: true },
      crop: { x: 4, y: 6, width: 80, height: 60 },
    });
    expect(migrated.layers.map((layer) => layer.type)).toEqual([
      'raster',
      'effect',
      'effect',
      'effect',
      'annotation',
    ]);
    expect(migrated.layers.slice(1, 4).map((layer) => layer.type === 'effect' ? layer.effectId : null)).toEqual([
      IMAGE_EDIT_OPERATION_IDS.blur,
      'vendor.future-effect',
      IMAGE_EDIT_OPERATION_IDS.diffusion,
    ]);
    expect(migrated.layers[1]).toMatchObject({
      type: 'effect',
      effectId: IMAGE_EDIT_OPERATION_IDS.blur,
      params: { algorithm: 'gaussian', strength: 0.3, radiusPixels: 1.2 },
      renderable: true,
    });
    expect(migrated.layers[3].visible).toBe(false);
  });

  it('把旧模糊半径冻结为源图坐标并保留 120px 封顶', () => {
    const source = createV2Document();
    const blur = source.operations.find(
      (operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.blur,
    );
    if (!blur) throw new Error('测试文档缺少模糊操作');
    blur.params = { schemaVersion: 1, algorithm: 'gaussian', strength: 1 };

    const migrated = migrateImageEditDocumentV2ToV3(source, {
      width: 20_000,
      height: 10_000,
      sourceResourceId: 'sha256:source',
      documentId: 'document-large-blur',
    });

    expect(migrated.layers[1]).toMatchObject({
      type: 'effect',
      effectId: IMAGE_EDIT_OPERATION_IDS.blur,
      params: { algorithm: 'gaussian', strength: 1, radiusPixels: 120 },
    });
  });

  it('未知操作保持原始 JSON 且明确不可渲染', () => {
    const source = createV2Document();
    const migrated = migrateImageEditDocumentV2ToV3(source, {
      width: 100,
      height: 120,
      sourceResourceId: 'sha256:source',
      documentId: 'document-migrated',
    });
    const unknown = migrated.layers.find(
      (layer) => layer.type === 'effect' && layer.effectId === 'vendor.future-effect'
    );
    expect(unknown).toMatchObject({ type: 'effect', renderable: false });
    if (unknown?.type !== 'effect') throw new Error('未知操作未迁移');
    expect(unknown.legacyOperation?.operation).toEqual(source.operations[3]);

    const roundTripped = decodeImageEditDocumentV3(stringifyImageEditDocumentV3(migrated)).document;
    const roundTrippedUnknown = roundTripped?.layers.find(
      (layer) => layer.type === 'effect' && layer.effectId === 'vendor.future-effect'
    );
    expect(roundTrippedUnknown).toEqual(unknown);
  });

  it('禁用朝向和裁剪不会改变输出几何', () => {
    const source = createV2Document();
    source.operations[0].enabled = false;
    source.operations[5].enabled = false;
    const migrated = migrateImageEditDocumentV2ToV3(source, {
      width: 100,
      height: 120,
      sourceResourceId: 'sha256:source',
      documentId: 'document-migrated',
    });
    expect(migrated.geometry.orientation).toEqual({ rotate: 0, mirrored: false });
    expect(migrated.geometry.crop).toBeNull();
  });

  it('旧文档没有真实标注时不创建空标注层', () => {
    const source = createV2Document();
    const annotations = source.operations.find(
      (operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.annotations,
    );
    if (!annotations) throw new Error('测试文档缺少标注操作');
    annotations.params = { items: [] };

    const migrated = migrateImageEditDocumentV2ToV3(source, {
      width: 100,
      height: 120,
      sourceResourceId: 'sha256:source',
      documentId: 'document-without-annotations',
    });

    expect(migrated.layers.some((layer) => layer.type === 'annotation')).toBe(false);
    expect(migrated.layers[0]).toMatchObject({ type: 'raster', id: 'layer-base-raster' });
  });
});
