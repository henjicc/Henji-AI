import { describe, expect, it } from 'vitest';
import {
  createDefaultImageEditColorModeV3,
  createImageEditHdrMetadataV3,
} from './colorTypes';
import { decodeImageEditDocumentV3, stringifyImageEditDocumentV3 } from './documentCodec';
import { createImageEditCanvasGeometryV3 } from './documentFactory';
import { IMAGE_EDIT_DOCUMENT_VERSION_V3, type ImageEditDocumentV3 } from './documentTypes';
import { createImageEditLayerCommonV3, type ImageEditGroupLayerV3 } from './layerTypes';

function createNestedDocument(): ImageEditDocumentV3 {
  const legacyOperation = {
    id: 'future-instance',
    operationId: 'vendor.future-light',
    enabled: true,
    params: { amount: 0.75, stops: [0, 0.5, 1], mode: 'future' },
  };
  const group: ImageEditGroupLayerV3 = {
    ...createImageEditLayerCommonV3('group-1', '光效组'),
    type: 'group',
    isolated: true,
    children: [{
      ...createImageEditLayerCommonV3('effect-1', '未知旧效果'),
      type: 'effect',
      effectId: 'vendor.future-light',
      params: { amount: 0.75, nested: { values: [1, true, null] } },
      renderable: false,
      legacyOperation: { sourceVersion: 2, operation: legacyOperation },
    }, {
      ...createImageEditLayerCommonV3('adjustment-1', '曝光'),
      type: 'adjustment',
      adjustmentId: 'image.exposure',
      params: { stops: 1.25, offset: 0, gamma: 1 },
      renderable: true,
    }],
  };
  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION_V3,
    id: 'document-1',
    revision: 7,
    geometry: createImageEditCanvasGeometryV3(4000, 3000),
    color: createDefaultImageEditColorModeV3(),
    layers: [group],
  };
}

describe('图片编辑 V3 文档编解码', () => {
  it('安全往返嵌套组、效果/调整参数和不可渲染的未知旧操作', () => {
    const source = createNestedDocument();
    const encoded = stringifyImageEditDocumentV3(source);
    const decoded = decodeImageEditDocumentV3(encoded);

    expect(decoded).toEqual({ document: source, sourceFormat: 'v3', issues: [] });
    const group = decoded.document?.layers[0];
    expect(group?.type).toBe('group');
    if (group?.type !== 'group') throw new Error('测试文档组解析失败');
    const unknown = group.children[0];
    expect(unknown).toMatchObject({ type: 'effect', renderable: false });
    if (unknown.type !== 'effect') throw new Error('测试文档未知效果解析失败');
    expect(unknown.legacyOperation?.operation).toEqual(
      (source.layers[0] as ImageEditGroupLayerV3).children[0].type === 'effect'
        ? ((source.layers[0] as ImageEditGroupLayerV3).children[0] as typeof unknown).legacyOperation?.operation
        : null
    );
  });

  it('拒绝重复图层 ID、非 JSON 参数和不一致的 HDR 契约', () => {
    const source = createNestedDocument();
    const group = source.layers[0] as ImageEditGroupLayerV3;
    const duplicate = {
      ...source,
      layers: [group, { ...group.children[0] }],
    };
    expect(decodeImageEditDocumentV3(duplicate).issues).toEqual(['invalid-v3-document']);

    const invalidParams = structuredClone(source) as ImageEditDocumentV3;
    const effect = (invalidParams.layers[0] as ImageEditGroupLayerV3).children[0];
    if (effect.type !== 'effect') throw new Error('测试文档未知效果不存在');
    Object.assign(effect.params, { invalid: Number.NaN });
    expect(decodeImageEditDocumentV3(invalidParams).document).toBeNull();

    expect(decodeImageEditDocumentV3({
      ...source,
      color: {
        workingSpace: 'srgb',
        bitDepth: 8,
        transferFunction: 'pq',
        hdrMetadata: { standard: 'pq' },
        iccProfileResourceId: null,
      },
    }).document).toBeNull();
  });

  it('完整往返参考白、CICP、内容亮度和母版显示元数据', () => {
    const source = createNestedDocument();
    const hdrMetadata = {
      ...createImageEditHdrMetadataV3('pq', {
        colorPrimaries: 9,
        transferCharacteristics: 16,
        matrixCoefficients: 9,
        fullRange: true,
      }),
      referenceWhiteNits: 203,
      contentLight: {
        maxContentLightLevelNits: 1_000,
        maxFrameAverageLightLevelNits: 400,
      },
      masteringDisplay: {
        red: { x: 0.708, y: 0.292 },
        green: { x: 0.17, y: 0.797 },
        blue: { x: 0.131, y: 0.046 },
        whitePoint: { x: 0.3127, y: 0.329 },
        maxLuminanceNits: 1_000,
        minLuminanceNits: 0.005,
      },
    };
    const document: ImageEditDocumentV3 = {
      ...source,
      color: {
        workingSpace: 'rec2020',
        bitDepth: 16,
        transferFunction: 'pq',
        hdrMetadata,
        iccProfileResourceId: null,
      },
    };

    expect(decodeImageEditDocumentV3(stringifyImageEditDocumentV3(document)).document?.color)
      .toEqual(document.color);
  });

  it('读取早期 HDR 字段后规范化，且不把无色度亮度范围伪装成 MDCV', () => {
    const source = createNestedDocument();
    const decoded = decodeImageEditDocumentV3({
      ...source,
      color: {
        workingSpace: 'rec2020',
        bitDepth: 16,
        transferFunction: 'pq',
        hdrMetadata: {
          standard: 'pq',
          maxLuminanceNits: 1_000,
          minLuminanceNits: 0.005,
          maxContentLightLevelNits: 800,
          maxFrameAverageLightLevelNits: 300,
        },
        iccProfileResourceId: null,
      },
    });

    expect(decoded.document?.color.hdrMetadata).toEqual({
      ...createImageEditHdrMetadataV3('pq'),
      contentLight: {
        maxContentLightLevelNits: 800,
        maxFrameAverageLightLevelNits: 300,
      },
    });
    expect(decoded.document?.color.hdrMetadata).not.toHaveProperty('masteringDisplay');
  });

  it('拒绝 HDR 传递函数不一致的 CICP 和越界的标准化元数据', () => {
    const source = createNestedDocument();
    const hdrDocument = (hdrMetadata: unknown) => ({
      ...source,
      color: {
        workingSpace: 'rec2020',
        bitDepth: 16,
        transferFunction: 'pq',
        hdrMetadata,
        iccProfileResourceId: null,
      },
    });

    expect(decodeImageEditDocumentV3(hdrDocument({
      ...createImageEditHdrMetadataV3('pq'),
      cicp: {
        colorPrimaries: 9,
        transferCharacteristics: 18,
        matrixCoefficients: 9,
        fullRange: false,
      },
    })).document).toBeNull();
    expect(decodeImageEditDocumentV3(hdrDocument({
      ...createImageEditHdrMetadataV3('pq'),
      contentLight: {
        maxContentLightLevelNits: 300,
        maxFrameAverageLightLevelNits: 400,
      },
    })).document).toBeNull();
    expect(decodeImageEditDocumentV3(hdrDocument({
      ...createImageEditHdrMetadataV3('pq'),
      masteringDisplay: {
        red: { x: 1.2, y: 0.292 },
        green: { x: 0.17, y: 0.797 },
        blue: { x: 0.131, y: 0.046 },
        whitePoint: { x: 0.3127, y: 0.329 },
        maxLuminanceNits: 1_000,
        minLuminanceNits: 0.005,
      },
    })).document).toBeNull();
  });

  it('只持久化整数像素裁剪，避免合法文档在导出阶段才失败', () => {
    const source = createNestedDocument();
    expect(decodeImageEditDocumentV3({
      ...source,
      geometry: {
        ...source.geometry,
        crop: { x: 0.5, y: 0, width: 100, height: 100 },
      },
    }).document).toBeNull();
  });
});
