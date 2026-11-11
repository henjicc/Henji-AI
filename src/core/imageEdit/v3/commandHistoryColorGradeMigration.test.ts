import { describe, expect, it } from 'vitest';
import { legacyWhiteBalanceToKelvin } from '../../imaging/adjustments/colorGradeMigration';
import { decodeImageEditCommandHistorySnapshotV3 } from './commandHistoryCodec';
import { applyImageEditCommandV3 } from './commandReducer';
import { createImageEditDocumentV3 } from './documentFactory';

// 全能调色参数 v2（2026-10-21）之前写下的历史页原样：参数里还有旧色温与创意分离色调。
const v1Params = (temperature: number) => ({
  temperature, tint: 0, exposure: 0, creative_shadow_hue: 200, creative_shadow_strength: 20,
  creative_highlight_hue: 0, creative_highlight_strength: 0, shadow_hue: 0, shadow_strength: 0, curve_master_points: [],
});
const gradeLayer = {
  id: 'grade', name: '全能调色', visible: true, locked: false, opacity: 1, fillOpacity: 1, clipping: false,
  maskAttachment: { enabled: true, linked: true, density: 1, transform: [1, 0, 0, 1, 0, 0] }, filters: [],
  blendMode: 'normal', transform: [1, 0, 0, 1, 0, 0], mask: null,
  type: 'adjustment', adjustmentId: 'color_grade', params: v1Params(0), renderable: true,
};
const entry = (forward: Record<string, unknown>, inverse: Record<string, unknown>) => ({
  forward, inverse, metadataBytes: new TextEncoder().encode(JSON.stringify([forward, inverse])).byteLength, resources: [],
});
const page = (headRevision: number, ...undo: unknown[]) => JSON.stringify({ version: 2, documentId: 'image-history-page', headRevision, undo, redo: [] });

describe('图片历史里的全能调色 v1 参数', () => {
  it('旧历史页按 v2 读出，撤销重做能回放到 v2 文档上', () => {
    const add = entry(
      { type: 'layer.add', commandId: 'add', expectedRevision: 0, parentId: null, index: 0, layer: gradeLayer, resources: [] },
      { type: 'layer.delete', commandId: 'add:inverse', expectedRevision: 1, layerId: 'grade', resources: [] },
    );
    const update = entry(
      { type: 'layer.update-params', commandId: 'warm', expectedRevision: 1, layerId: 'grade', params: v1Params(10) },
      { type: 'layer.update-params', commandId: 'warm:inverse', expectedRevision: 2, layerId: 'grade', params: v1Params(0) },
    );
    const [added, warmed] = decodeImageEditCommandHistorySnapshotV3(page(2, add, update)).snapshot.undo;

    const params = (warmed.forward as { params: Record<string, unknown> }).params;
    expect(Object.keys(params).filter(key => key === 'temperature' || key.startsWith('creative_'))).toEqual([]);
    expect(params.temperature_kelvin).toBeCloseTo(legacyWhiteBalanceToKelvin(10, 0).temperature_kelvin, 2);
    expect(params).toMatchObject({ shadow_hue: 200, shadow_strength: 20 });
    expect(warmed.metadataBytes).toBe(new TextEncoder().encode(JSON.stringify([warmed.forward, warmed.inverse])).byteLength);

    let document = createImageEditDocumentV3({ width: 4, height: 4, documentId: 'grade-history' });
    for (const command of [added.forward, warmed.forward, warmed.inverse, added.inverse, added.forward]) {
      document = applyImageEditCommandV3(document, { ...command, expectedRevision: document.revision }).document;
    }
    expect(document.layers).toEqual([(added.forward as { layer: unknown }).layer]);
  });

  it('只带部分旧版键（只有 temperature）的改参数命令，回放历史时按全能调色图层换算；普通写入仍按新版校验', () => {
    const v2Layer = { ...gradeLayer, params: {} };
    let document = createImageEditDocumentV3({ width: 4, height: 4, documentId: 'grade-sparse' });
    document = applyImageEditCommandV3(document, { type: 'layer.add', commandId: 'add', expectedRevision: 0, parentId: null, index: 0, layer: v2Layer, resources: [] } as never).document;
    const sparse = { type: 'layer.update-params', commandId: 'sparse', expectedRevision: document.revision, layerId: 'grade', params: { temperature: 30 } } as never;
    expect(() => applyImageEditCommandV3(document, sparse)).toThrow();
    const replayed = applyImageEditCommandV3(document, sparse, { allowLegacyResourceMetadata: true }).document;
    const params = (replayed.layers[0] as { params: Record<string, unknown> }).params;
    expect(params.temperature).toBeUndefined();
    expect(params.temperature_kelvin).toBeCloseTo(legacyWhiteBalanceToKelvin(30, 0).temperature_kelvin, 0);
  });

  it('v2 参数与色温/色调调整图层的同名参数原样保留', () => {
    const temperatureTint = { temperature: .2, tint: .1, workingSpace: 'srgb' };
    const v2Grade = { temperature_kelvin: 5000, tint: 5, exposure: .5 };
    const tint = entry(
      { type: 'layer.update-params', commandId: 'tint', expectedRevision: 0, layerId: 'temperature', params: temperatureTint },
      { type: 'layer.update-params', commandId: 'tint:inverse', expectedRevision: 1, layerId: 'temperature', params: { temperature: 0, tint: 0, workingSpace: 'srgb' } },
    );
    const grade = entry(
      { type: 'layer.update-params', commandId: 'grade', expectedRevision: 1, layerId: 'grade', params: v2Grade },
      { type: 'layer.update-params', commandId: 'grade:inverse', expectedRevision: 2, layerId: 'grade', params: {} },
    );
    expect(decodeImageEditCommandHistorySnapshotV3(page(2, tint, grade)).snapshot.undo).toEqual([tint, grade]);
  });
});
