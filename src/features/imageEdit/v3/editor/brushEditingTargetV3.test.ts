import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';
import { identityDeformation } from '@/core/imaging/transforms';
import { resolveImageEditorBrushEditingTargetV3 } from './brushEditingTargetV3';
describe('非破坏变形的原像素绘画边界',()=>{
  it('拒绝把非线性画面当仿射写回；恢复原像素后可画，独立蒙版可直接画',()=>{
    const document=createImageEditDocumentV3({width:100,height:80}),layer=createImageEditRasterLayerV3('source','原像素');document.layers=[layer];layer.deformation=identityDeformation('mesh');layer.mask=createImageEditSparseMaskReferenceV3('mask');
    const input={document,selectedLayerIds:[layer.id],activeTool:'raster-brush' as const,maskMode:'paint' as const,resourceByteSizes:new Map<string,number>()};
    expect(resolveImageEditorBrushEditingTargetV3(input)).toEqual({ready:false,reason:'deformed'});
    expect(resolveImageEditorBrushEditingTargetV3({...input,editTarget:'mask'})).toEqual({ready:false,reason:'deformed'});
    layer.maskAttachment.linked=false;expect(resolveImageEditorBrushEditingTargetV3({...input,editTarget:'mask'}).ready).toBe(true);
    layer.deformation=null;expect(resolveImageEditorBrushEditingTargetV3(input).ready).toBe(true);
  });
});
