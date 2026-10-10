import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory';
import { createImageEditSparseMaskReferenceV3 } from '../layerTypes';
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';
import { createFloat32MaskTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts';
import { executeImageEditCpuRenderPlanV3 } from '../execution/cpuRenderPlanExecutor';
import { executeImageEditCpuRenderRegionPlanV3, collectImageEditCpuRegionRequirementsV3 } from '../execution/cpuRenderRegionExecutor';
import type { ImageEditRect } from '../tileGeometry';
import type { ImageEditDocumentV3 } from '../documentTypes';
import type { EvaluationContext } from '../../../imaging/evaluation';

const registry = createBuiltInImageEditRenderNodeRegistry();
const rgba = (region: { width: number; height: number }, color: readonly number[]) => {
  const data = new Float32Array(region.width*region.height*4);
  for (let i=0; i<data.length; i+=4) data.set(color,i);
  return createFloat32PremultipliedRgbaTile(region.width, region.height, 'linear-light', data);
};
const fullRegion = { x:0, y:0, width:4, height:2 };
function document() {
  const source = createImageEditDocumentV3({ width:4, height:2, documentId:'composite' });
  source.layers = [createImageEditRasterLayerV3('base','base')];
  return source;
}
async function compare(source: ImageEditDocumentV3, region: ImageEditRect = fullRegion) {
  const plan = compileImageEditRenderPlanV3(source, registry, 'export');
  const full = await executeImageEditCpuRenderPlanV3(plan, {
    loadRaster: async node => rgba(fullRegion, node.layerId === 'base' ? [.2,0,0,.4] : [0,0,.5,.5]),
    rasterizeVectorContent: async () => { throw new Error('无标注'); },
    loadMask: async () => createFloat32MaskTile(4,2,new Float32Array(8).fill(.5)),
  });
  const tiled = await executeImageEditCpuRenderRegionPlanV3(plan, region, {
    size: source.geometry, registry,
    createTransparent: requested => rgba(requested,[0,0,0,0]),
    loadRaster: async (node,requested) => rgba(requested, node.layerId === 'base' ? [.2,0,0,.4] : [0,0,.5,.5]),
    rasterizeVectorContent: async () => { throw new Error('无标注'); },
    loadMask: async (_mask,_node,requested) => createFloat32MaskTile(requested.width,requested.height,new Float32Array(requested.width*requested.height).fill(.5)),
  });
  expect([...tiled!.data.slice(0,4)]).toEqual([...full!.data.slice(0,4)]);
  return full!;
}
describe('共同合成顺序、区域与时间失效', () => {
  it('fill 在局部滤镜前，密度/蒙版在滤镜后，整体 opacity 最后；分块与全幅一致', async () => {
    const source = document(), base = source.layers[0];
    base.fillOpacity = .5; base.opacity = .5;
    base.mask = createImageEditSparseMaskReferenceV3('mask'); base.maskAttachment.density = .5;
    base.filters = [{ id:'exposure', operationType:'adjustment', effectId:'exposure', params:{stops:1}, enabled:true, opacity:1, blendMode:'normal', mask:null }];
    const result = await compare(source,{x:2,y:1,width:2,height:1});
    expect(result.data[0]).toBeCloseTo(.075,6); expect(result.data[3]).toBeCloseTo(.075,6);
  });
  it('连续剪贴保持基底半透明覆盖，基底透明度在整个栈后应用，隐藏基底隐藏整个栈', async () => {
    const source = document(); source.layers[0].fillOpacity=.5; source.layers[0].opacity=.5;
    const top = createImageEditRasterLayerV3('top','clip'); top.clipping=true; source.layers.push(top);
    const result = await compare(source);
    expect(result.data[0]).toBeCloseTo(.025,6); expect(result.data[2]).toBeCloseTo(.05,6); expect(result.data[3]).toBeCloseTo(.1,6);
    source.layers[0].visible=false;
    expect(compileImageEditRenderPlanV3(source,registry,'export').outputNodeId).toBeNull();
  });
  it('内容身份不含名称/锁定；滤镜、区域/时间版本和质量进入身份，独立蒙版使用自身逆 ROI', () => {
    const source = document(); const before=compileImageEditRenderPlanV3(source,registry,'stable');
    source.layers[0].name='renamed'; source.layers[0].locked=true;
    expect(compileImageEditRenderPlanV3(source,registry,'stable').outputHash).toBe(before.outputHash);
    const evaluation: EvaluationContext = { target:{kind:'clip',id:'clip'},sourceVersion:'v1',time:{kind:'frame',ticks:1,timeBase:[1,30],frameId:'f1'},
      referenceGrid:source.geometry,roi:fullRegion,color:{workingSpace:'srgb',transferFunction:'linear',alpha:'premultiplied',precision:'float32'},quality:'final' };
    const frame=compileImageEditRenderPlanV3(source,registry,'export','final',evaluation);
    expect(compileImageEditRenderPlanV3(source,registry,'export','final',{...evaluation,time:{kind:'frame',ticks:2,timeBase:[1,30],frameId:'f2'}}).outputHash).not.toBe(frame.outputHash);
    source.layers[0].mask=createImageEditSparseMaskReferenceV3('mask');
    source.layers[0].transform=[1,0,0,1,2,0]; source.layers[0].maskAttachment.linked=false;
    const plan=compileImageEditRenderPlanV3(source,registry,'export');
    const required=collectImageEditCpuRegionRequirementsV3(plan,[{x:2,y:0,width:1,height:1}],{registry,size:source.geometry});
    expect([...required.maskRegions.values()][0][0].x).toBeGreaterThanOrEqual(1);
    expect([...required.rasterRegions.values()][0][0].x).toBe(0);
  });
});
