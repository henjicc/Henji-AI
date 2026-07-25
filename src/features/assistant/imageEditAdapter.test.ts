import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_STROKE_HEX, ANNOTATION_DEFAULT_TEXT_HEX } from '@/core/theme/colorTokens';
import { createEmptyImageEditDocument, createImageEditOperation, imageEditDocumentToMarkDoc, IMAGE_EDIT_OPERATION_IDS, upsertImageEditOperation } from '@/core/imageEdit';
import { buildImageEditDocumentFromAssistantOperations } from './imageEditAdapter';

describe('智能助手图片编辑适配', () => {
  it('按操作顺序重映射标注、朝向和旋转后的裁剪空间', () => {
    const document = buildImageEditDocumentFromAssistantOperations([
      {
        kind: 'mark',
        item: {
          type: 'rect',
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          stroke: ANNOTATION_DEFAULT_STROKE_HEX,
          lineWidth: 3,
        },
      },
      { kind: 'rotate_cw', degrees: 90 },
      { kind: 'crop', crop: { x: 10, y: 20, width: 100, height: 150 } },
    ], { width: 400, height: 200 });

    expect(imageEditDocumentToMarkDoc(document)).toMatchObject({
      orientation: { rotate: 90, mirrored: false },
      items: [{ type: 'rect', x: 140, y: 10, width: 40, height: 30 }],
      crop: { x: 10, y: 20, width: 100, height: 150 },
    });
  });

  it('兼容全部标注类型并为缺少 ID 的标注生成实例 ID', () => {
    const items = [
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'ellipse', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'arrow', points: [1, 2, 3, 4], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'pen', points: [1, 2, 3, 4], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'text', x: 1, y: 2, text: '说明', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 12 },
      { type: 'number', x: 1, y: 2, color: ANNOTATION_DEFAULT_STROKE_HEX, fontSize: 12 },
      { type: 'mosaic', x: 1, y: 2, width: 3, height: 4, strengthPercent: 20, mode: 'blur' },
    ];
    const document = buildImageEditDocumentFromAssistantOperations(
      items.map((item) => ({ kind: 'mark', item })),
      { width: 100, height: 100 }
    );
    const markDoc = imageEditDocumentToMarkDoc(document);

    expect(markDoc.items.map((item) => item.type)).toEqual([
      'rect',
      'ellipse',
      'arrow',
      'pen',
      'text',
      'number',
      'mosaic',
    ]);
    expect(markDoc.items.every((item) => item.id.length > 0)).toBe(true);
  });

  it('拒绝旋转后越界裁剪和非 90 度倍数旋转', () => {
    expect(() => buildImageEditDocumentFromAssistantOperations([
      { kind: 'rotate_cw', degrees: 90 },
      { kind: 'crop', crop: { x: 150, y: 0, width: 100, height: 100 } },
    ], { width: 400, height: 200 })).toThrow('INVALID_INPUT');

    expect(() => buildImageEditDocumentFromAssistantOperations([
      { kind: 'rotate_cw', degrees: 45 },
    ], { width: 400, height: 200 })).toThrow();
  });

  it('更新助手标注时保留既有柔光与未知 V2 操作', () => {
    const existing = upsertImageEditOperation(
      createEmptyImageEditDocument(),
      createImageEditOperation(IMAGE_EDIT_OPERATION_IDS.diffusion, {
        schemaVersion: 1,
        mode: 'black_mist', presetId: null, strength: 0.3, density: '1/4',
        source: { thresholdEV: 1, softKneeEV: 1, power: 1, highlightRecovery: 0 },
        scatter: { highlightAmount: 0.1, microAmount: 0, nearRadius: 0, farRadius: 0.04, tailAmount: 0, tailShape: 2, anisotropy: 0, angle: 0, chromaticSpread: 0 },
        tone: { veil: 0, blackRetention: 1, highlightCompression: 0, scatterDesaturation: 0 },
        detail: { highFrequencyRetention: 1, midFrequencyRetention: 1 },
        lens: { focalLengthEq: 50, aperture: 2.8, positionVariation: 0 }, quality: 'realtime',
      })
    );
    existing.operations.splice(2, 0, { id: 'future', operationId: 'image.future', enabled: true, params: { amount: 1 } });
    const updated = buildImageEditDocumentFromAssistantOperations([
      { kind: 'mark', item: { type: 'text', x: 2, y: 3, text: '保留', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 12 } },
    ], { width: 100, height: 100 }, existing);

    expect(updated.operations.find((operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion)).toBeDefined();
    expect(updated.operations.find((operation) => operation.operationId === 'image.future')).toBeDefined();
    expect(imageEditDocumentToMarkDoc(updated).items).toHaveLength(1);
  });
});
