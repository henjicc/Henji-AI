import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_STROKE_HEX, ANNOTATION_DEFAULT_TEXT_HEX, BLACK_HEX, IMAGE_EDITOR_GLOW_TINT_HEX } from '@/core/theme/colorTokens';
import { createDefaultDiffusionOperationParams, createDefaultVgpuGlowOperationParams, createEmptyImageEditDocument, createImageEditOperation, getImageEditOperation, imageEditDocumentToMarkDoc, IMAGE_EDIT_OPERATION_IDS, upsertImageEditOperation, type DiffusionOperationParams, type VgpuGlowOperationParams } from '@/core/imageEdit';
import { listImageEditorToolControls } from '@/features/imageEdit/tools/controlCatalog';
import { buildImageEditDocumentFromControlOperations } from './imageEditDocumentBuilder';

describe('智能助手图片编辑适配', () => {
  it('按操作顺序重映射标注、朝向和旋转后的裁剪空间', () => {
    const document = buildImageEditDocumentFromControlOperations([
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
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1, label: '说明', labelFontSize: 8, labelDx: 2, labelDy: 3, labelBackgroundColor: BLACK_HEX },
      { type: 'ellipse', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'arrow', points: [1, 2, 3, 4], curveControl: [2, 1], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'pen', points: [1, 2, 3, 4], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1 },
      { type: 'text', x: 1, y: 2, text: '说明', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 12, backgroundColor: BLACK_HEX },
      { type: 'number', x: 1, y: 2, color: ANNOTATION_DEFAULT_STROKE_HEX, fontSize: 12 },
      { type: 'mosaic', x: 1, y: 2, width: 3, height: 4, strengthPercent: 2, mode: 'blur' },
    ];
    const document = buildImageEditDocumentFromControlOperations(
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
    expect(markDoc.items[0]).toMatchObject({ labelBackgroundColor: BLACK_HEX });
    expect(markDoc.items[2]).toMatchObject({ curveControl: [2, 1] });
    expect(markDoc.items[4]).toMatchObject({ backgroundColor: BLACK_HEX });
  });

  it('按旋转后的真实尺寸拒绝越界或小于执行下限的裁剪，并给出可直接修正的信息', () => {
    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'rotate_cw', degrees: 90 },
      { kind: 'crop', crop: { x: 150, y: 0, width: 100, height: 100 } },
    ], { width: 400, height: 200 })).toThrow(/当前图片 200×400.*x \+ width ≤ 200/);

    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'crop', crop: { x: 0, y: 0, width: 7, height: 20 } },
    ], { width: 100, height: 80 })).toThrow(/当前图片 100×80.*width 和 height 至少为 8/);

    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'rotate_cw', degrees: 45 },
    ], { width: 400, height: 200 })).toThrow();
  });

  it('图片编辑器每个正式工具都向助手声明至少一种可执行操作', () => {
    expect(listImageEditorToolControls().map((tool) => [tool.id, tool.kinds])).toEqual([
      ['geometry', ['rotate_cw', 'rotate_ccw', 'flip_h', 'flip_v', 'crop', 'mark']],
      ['blur', ['blur']],
      ['diffusion', ['diffusion']],
      ['vgpuGlow', ['vgpu_glow']],
    ]);
  });

  it('能从语义参数构建柔光和辉光 Pro 文档', () => {
    const diffusionDocument = buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      mode: 'white_mist',
      density: 'high',
      strength: 0.66,
      tint: { enabled: true, hue: 32, saturation: 0.4, lightness: 0.1 },
    }], { width: 100, height: 100 });
    const diffusion = getImageEditOperation<DiffusionOperationParams>(
      diffusionDocument,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
    );
    expect(diffusion?.params).toMatchObject({
      schemaVersion: createDefaultDiffusionOperationParams().schemaVersion,
      mode: 'white_mist',
      density: 'high',
      strength: 0.66,
      tint: { enabled: true, hue: 32, saturation: 0.4, lightness: 0.1 },
    });

    const glowDocument = buildImageEditDocumentFromControlOperations([{
      kind: 'vgpu_glow',
      look: 'neon',
      intensity: 0.74,
      chromaticAberration: 0.25,
      chromaticChannels: ['green', 'blue'],
    }], { width: 100, height: 100 });
    const glow = getImageEditOperation<VgpuGlowOperationParams>(
      glowDocument,
      IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
    );
    expect(glow?.params).toMatchObject({
      schemaVersion: createDefaultVgpuGlowOperationParams().schemaVersion,
      look: 'neon',
      intensity: 0.74,
      chromaticAberration: 0.25,
      chromaticChannels: ['green', 'blue'],
    });
  });

  it('从明确的专属参数安全推断柔光模式与着色开关', () => {
    const diffusionDocument = buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      glowExposure: 0.7,
      tint: { hue: 28, saturation: 0.6 },
    }], { width: 100, height: 100 });
    const diffusion = getImageEditOperation<DiffusionOperationParams>(
      diffusionDocument,
      IMAGE_EDIT_OPERATION_IDS.diffusion,
    );
    expect(diffusion?.params).toMatchObject({
      mode: 'glow',
      glowExposure: 0.7,
      tint: { enabled: true, hue: 28, saturation: 0.6 },
    });

    const glowDocument = buildImageEditDocumentFromControlOperations([{
      kind: 'vgpu_glow',
      tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    }], { width: 100, height: 100 });
    const glow = getImageEditOperation<VgpuGlowOperationParams>(
      glowDocument,
      IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
    );
    expect(glow?.params).toMatchObject({
      tintEnabled: true,
      tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    });
  });

  it('拒绝会静默失效的模式专属参数，并给出可直接修正的选项', () => {
    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      mode: 'black_mist',
      glowExposure: 0.7,
    }], { width: 100, height: 100 })).toThrow(/请把 mode 改为/);

    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      mode: 'glow',
      blackRetention: 0.8,
    }], { width: 100, height: 100 })).toThrow(/请改用/);

    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      glowExposure: 0.7,
      detailRetention: 0.8,
    }], { width: 100, height: 100 })).toThrow(/请明确选择一种 mode/);
  });

  it('拒绝关闭着色却同时提供颜色参数，并给出可直接修正的选项', () => {
    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'diffusion',
      tint: { enabled: false, hue: 28 },
    }], { width: 100, height: 100 })).toThrow(/请把 enabled 改为 true/);

    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'vgpu_glow',
      tintEnabled: false,
      tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
    }], { width: 100, height: 100 })).toThrow(/请把 tintEnabled 改为 true/);
  });

  it('拒绝没有有效色差强度的通道选择，并给出可直接修正的选项', () => {
    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'vgpu_glow',
      chromaticChannels: ['green', 'blue'],
    }], { width: 100, height: 100 })).toThrow(/请提供大于 0 的 chromaticAberration/);

    expect(() => buildImageEditDocumentFromControlOperations([{
      kind: 'vgpu_glow',
      chromaticAberration: 0,
      chromaticChannels: ['green', 'blue'],
    }], { width: 100, height: 100 })).toThrow(/请提供大于 0 的 chromaticAberration/);
  });

  it.each([
    {
      label: '先柔光后辉光 Pro',
      operations: [
        { kind: 'diffusion' as const, mode: 'glow' as const },
        { kind: 'vgpu_glow' as const, look: 'dreamy' as const },
      ],
    },
    {
      label: '先辉光 Pro 后柔光',
      operations: [
        { kind: 'vgpu_glow' as const, look: 'dreamy' as const },
        { kind: 'diffusion' as const, mode: 'glow' as const },
      ],
    },
  ])('$label 时拒绝静默关闭其中一套参数', ({ operations }) => {
    expect(() => buildImageEditDocumentFromControlOperations(
      operations,
      { width: 100, height: 100 },
    )).toThrow(/请选择并只保留一种光效/);
  });

  it('拒绝会被构建器静默覆盖的重复单例操作与标注 ID', () => {
    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'blur', strength: 0.2 },
      { kind: 'blur', strength: 0.8 },
    ], { width: 100, height: 100 })).toThrow(/blur 只能出现一次/);

    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'mark', item: { id: 'same', type: 'text', x: 1, y: 2, text: '一', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
      { kind: 'mark', item: { id: 'same', type: 'text', x: 3, y: 4, text: '二', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
    ], { width: 100, height: 100 })).toThrow(/标注 id 不能重复/);
  });

  it.each([
    {
      label: '既有柔光上新增辉光 Pro',
      existingId: IMAGE_EDIT_OPERATION_IDS.diffusion,
      existingParams: createDefaultDiffusionOperationParams(),
      incoming: { kind: 'vgpu_glow' as const, look: 'neon' as const },
      incomingId: IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
    },
    {
      label: '既有辉光 Pro 上新增柔光',
      existingId: IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
      existingParams: createDefaultVgpuGlowOperationParams(),
      incoming: { kind: 'diffusion' as const, mode: 'white_mist' as const },
      incomingId: IMAGE_EDIT_OPERATION_IDS.diffusion,
    },
  ])('$label 时关闭旧光效并保留其参数', ({ existingId, existingParams, incoming, incomingId }) => {
    const existingOperation = createImageEditOperation(existingId, existingParams, 'existing-effect');
    const existing = upsertImageEditOperation(createEmptyImageEditDocument(), existingOperation);
    const updated = buildImageEditDocumentFromControlOperations(
      [incoming],
      { width: 100, height: 100 },
      existing,
    );

    expect(getImageEditOperation(updated, existingId)).toMatchObject({
      id: 'existing-effect',
      enabled: false,
      params: existingParams,
    });
    expect(getImageEditOperation(updated, incomingId)?.enabled).toBe(true);
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
    const updated = buildImageEditDocumentFromControlOperations([
      { kind: 'mark', item: { type: 'text', x: 2, y: 3, text: '保留', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 12 } },
    ], { width: 100, height: 100 }, existing);

    expect(updated.operations.find((operation) => operation.operationId === IMAGE_EDIT_OPERATION_IDS.diffusion)).toBeDefined();
    expect(updated.operations.find((operation) => operation.operationId === 'image.future')).toBeDefined();
    expect(imageEditDocumentToMarkDoc(updated).items).toHaveLength(1);
  });
});
