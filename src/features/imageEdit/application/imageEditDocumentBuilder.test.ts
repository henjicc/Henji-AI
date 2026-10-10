import { describe, expect, it } from 'vitest';
import { ANNOTATION_DEFAULT_STROKE_HEX, ANNOTATION_DEFAULT_TEXT_HEX, BLACK_HEX, IMAGE_EDITOR_GLOW_TINT_HEX } from '@/core/theme/colorTokens';
import { createDefaultDiffusionOperationParams, createDefaultVgpuGlowOperationParams } from '@/core/imageEdit';
import { createImageEditDocumentV3, createImageEditEffectLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes';
import { IMAGE_EDIT_DOCUMENT_VERSION_V3 } from '@/core/imageEdit/v3/documentTypes';
import type { ImageEditEffectLayerV3 } from '@/core/imageEdit/v3/layerTypes';
function effect(document: ImageEditDocumentV3, id: string) { return document.layers.find((layer): layer is ImageEditEffectLayerV3 => layer.type === 'effect' && layer.effectId === id); }
import { listImageEditorToolControls } from '@/features/imageEdit/tools/controlCatalog';
import { buildImageEditDocumentFromControlOperations } from './imageEditDocumentBuilder';

describe('智能助手图片编辑适配', () => {
  it('快速矩形与中文文字升级为正式图层，并保持原图坐标及输出几何',()=>{
    const document=buildImageEditDocumentFromControlOperations([
      {kind:'mark',item:{id:'rect',type:'rect',x:10,y:20,width:30,height:40,stroke:ANNOTATION_DEFAULT_STROKE_HEX,lineWidth:3}},
      {kind:'mark',item:{id:'text',type:'text',x:40,y:50,text:'说明',color:ANNOTATION_DEFAULT_TEXT_HEX,fontSize:12,backgroundColor:BLACK_HEX}},
      {kind:'rotate_cw',degrees:90},{kind:'crop',crop:{x:10,y:20,width:100,height:150}},
    ],{width:400,height:200})
    expect(document.layers).toMatchObject([{id:'rect',type:'shape',content:{operands:[{path:{commands:[{kind:'move',x:10,y:20},{kind:'line',x:40,y:20},{kind:'line',x:40,y:60},{kind:'line',x:10,y:60},{kind:'close'}]}}]}},{id:'text',type:'text',content:{paragraphs:[{runs:[{text:'说明',style:{background:{enabled:true,color:BLACK_HEX}}}]}]}}])
    expect(document.geometry).toMatchObject({orientation:{rotate:90,mirrored:false},crop:{x:10,y:20,width:100,height:150}})
  })

  it('按旋转后的真实尺寸拒绝越界或小于执行下限的裁剪，并给出可直接修正的信息', () => {
    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'rotate_cw', degrees: 90 },
      { kind: 'crop', crop: { x: 150, y: 0, width: 100, height: 100 } },
    ], { width: 400, height: 200 })).toThrow();

    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'crop', crop: { x: 0, y: 0, width: 0, height: 20 } },
    ], { width: 100, height: 80 })).toThrow();

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
    const diffusion = effect(
      diffusionDocument,
      'image.diffusion',
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
    const glow = effect(
      glowDocument,
      'image.vgpu-glow',
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
    const diffusion = effect(
      diffusionDocument,
      'image.diffusion',
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
    const glow = effect(
      glowDocument,
      'image.vgpu-glow',
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
  ])('$label 时顺序保留两套独立图层', ({ operations }) => {
    expect(buildImageEditDocumentFromControlOperations(
      operations,
      { width: 100, height: 100 },
    ).layers.filter(layer => layer.type === 'effect')).toHaveLength(2);
  });

  it('允许重复效果、拒绝重复标注 ID', () => {
    expect(buildImageEditDocumentFromControlOperations([
      { kind: 'blur', sigma_fraction_height: 0.02 },
      { kind: 'blur', sigma_fraction_height: 0.08 },
    ], { width: 100, height: 100 }).layers).toHaveLength(2);

    expect(() => buildImageEditDocumentFromControlOperations([
      { kind: 'mark', item: { id: 'same', type: 'text', x: 1, y: 2, text: '一', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
      { kind: 'mark', item: { id: 'same', type: 'text', x: 3, y: 4, text: '二', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
    ], { width: 100, height: 100 })).toThrow(/标注 id 不能重复/);
  });

  it.each([
    {
      label: '既有柔光上新增辉光 Pro',
      existingId: 'image.diffusion',
      existingParams: createDefaultDiffusionOperationParams(),
      incoming: { kind: 'vgpu_glow' as const, look: 'neon' as const },
      incomingId: 'image.vgpu-glow',
    },
    {
      label: '既有辉光 Pro 上新增柔光',
      existingId: 'image.vgpu-glow',
      existingParams: createDefaultVgpuGlowOperationParams(),
      incoming: { kind: 'diffusion' as const, mode: 'white_mist' as const },
      incomingId: 'image.diffusion',
    },
  ])('$label 时保留已有光效并追加新图层', ({ existingId, existingParams, incoming, incomingId }) => {
    const existing = createImageEditDocumentV3({ width: 100, height: 100 });
    existing.layers.push(createImageEditEffectLayerV3('existing-effect', '已有光效', existingId, JSON.parse(JSON.stringify(existingParams))));
    const updated = buildImageEditDocumentFromControlOperations(
      [incoming],
      { width: 100, height: 100 },
      existing,
    );

    expect(effect(updated, existingId)).toMatchObject({
      id: 'existing-effect',
      visible: true,
      params: existingParams,
    });
    expect(effect(updated, incomingId)?.visible).toBe(true);
  });

  it('追加标注时保留已有 V3 图层，操作数不受旧 32 条上限约束', () => {
    const existing = createImageEditDocumentV3({ width: 100, height: 100 });
    existing.layers.push(createImageEditEffectLayerV3('existing', '柔光', 'image.diffusion', JSON.parse(JSON.stringify(createDefaultDiffusionOperationParams()))));
    const updated = buildImageEditDocumentFromControlOperations(Array.from({ length: 40 }, (_, index) => ({ kind: 'mark', item: { id: `mark-${index}`, type: 'text', x: 2, y: 3, text: '保留', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 12 } })), { width: 100, height: 100 }, existing);
    expect(updated.layers[0]).toEqual(existing.layers[0]);
    expect(updated.layers.filter(layer=>layer.type==='text')).toHaveLength(40);
    expect(updated.version).toBe(IMAGE_EDIT_DOCUMENT_VERSION_V3);
  });
});
