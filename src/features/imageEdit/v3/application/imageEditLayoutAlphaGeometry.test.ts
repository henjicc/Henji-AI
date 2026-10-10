import { afterEach, expect, it, vi } from 'vitest'
import { mapAffine, type Affine, type Point } from '@/core/imaging/transforms'
import { createImageEditDocumentV3, createImageEditPathLayerV3, createImageEditRasterLayerV3, createImageEditTextLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageLayoutAlphaSupport, measureImageLayoutRaster } from './imageEditLayoutAlphaGeometry'
import { measureImageLayoutLayer } from './imageEditLayoutGeometry'
import { ImageEditorVectorRasterClientV3 } from '../execution/vectorRasterClientV3'

const ports=vi.hoisted(()=>({metadata:vi.fn(),source:vi.fn(),brush:vi.fn()}))
vi.mock('@/commands/imageEditorV3',()=>({createImageEditorV3RequestId:()=> 'geometry',readImageEditorV3SourceMetadata:ports.metadata,readImageEditorV3SourceTile:ports.source,readImageEditorV3BrushTiles:ports.brush}))
vi.mock('@/services/vectorContent/fonts',()=>({ensureVectorDocumentFonts:vi.fn(async()=>undefined),prepareVectorDocumentFonts:vi.fn(async()=>[])}))
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals()})
const bounds=(points:Point[],matrix:Affine):number[]=>points.map(p=>mapAffine(matrix,p)).reduce((a,p)=>[Math.min(a[0],p[0]),Math.max(a[1],p[0]),Math.min(a[2],p[1]),Math.max(a[3],p[1])],[Infinity,-Infinity,Infinity,-Infinity])
it('真实 Alpha 支撑点保留裁剪坐标、旋转/镜像/非均匀斜切后的边缘，误差为零',()=>{
  const matrix:Affine=[-2,.7,.3,.6,-17,23],support=new ImageLayoutAlphaSupport(matrix)
  const alpha=new Uint8Array([0,255,0,0,0,255,0,0,0,0,255,0,0,0,0,0])
  support.scan(8,2,i=>alpha[i])
  const actual:Point[]=[]
  for(let i=0;i<alpha.length;i++)if(alpha[i]){const x=i%8,y=Math.floor(i/8);actual.push([x,y],[x+1,y],[x+1,y+1],[x,y+1])}
  expect(bounds(support.result(),matrix)).toEqual(bounds(actual,matrix))
  expect(new ImageLayoutAlphaSupport(matrix).result()).toEqual([])
})
it('全不透明源走正式元数据；透明源读 mip0，不使用缩小的命中代理',async()=>{
  const layer=createImageEditRasterLayerV3('a','图片');layer.source={kind:'resource',resourceId:`sha256:${'a'.repeat(64)}`}
  ports.metadata.mockResolvedValue({width:1024,height:512,hasAlpha:false})
  const points=await measureImageLayoutRaster(layer,[1,0,0,1,0,0],new AbortController().signal,{})
  expect(bounds(points,[1,0,0,1,0,0])).toEqual([0,1024,0,512]);expect(ports.source).not.toHaveBeenCalled()
  ports.metadata.mockResolvedValue({width:2,height:2,hasAlpha:true})
  ports.source.mockResolvedValue({width:2,height:2,originX:0,originY:0,bitDepth:32,pixels:new Float32Array([0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0]).buffer})
  const transparent=await measureImageLayoutRaster(layer,[1,0,0,1,0,0],new AbortController().signal,{})
  expect(bounds(transparent,[1,0,0,1,0,0])).toEqual([1,2,0,1])
  expect(ports.source.mock.calls[0][0]).toMatchObject({mip:0,bitDepth:32})
  ports.source.mockResolvedValue({width:2,height:2,originX:0,originY:0,bitDepth:32,pixels:new Float32Array([0,0,0,1e-8,0,0,0,0,0,0,0,0,0,0,0,0]).buffer})
  expect(bounds(await measureImageLayoutRaster(layer,[1,0,0,1,0,0],new AbortController().signal,{}),[1,0,0,1,0,0])).toEqual([0,1,0,1])
})
it('稀疏覆盖替换基图单元，擦空不残留原边缘；缺元数据与取消拒绝',async()=>{
  const layer=createImageEditRasterLayerV3('a','画笔'),id=`sha256:${'b'.repeat(64)}`
  layer.source={kind:'resource',resourceId:`sha256:${'a'.repeat(64)}`};layer.tiles={'0/0/0':id}
  ports.metadata.mockResolvedValue({width:2,height:2,hasAlpha:false})
  ports.brush.mockResolvedValue({tiles:[{tile:{storage:'rgba-float32',width:2,height:2,data:new Float32Array(16)}}]})
  expect(await measureImageLayoutRaster(layer,[1,0,0,1,0,0],new AbortController().signal,{[id]:64})).toEqual([])
  expect(ports.source).not.toHaveBeenCalled()
  await expect(measureImageLayoutRaster(layer,[1,0,0,1,0,0],new AbortController().signal,{})).rejects.toThrow('资源未就绪')
  const abort=new AbortController();abort.abort()
  await expect(measureImageLayoutRaster(layer,[1,0,0,1,0,0],abort.signal,{[id]:64})).rejects.toThrow()
})
it('矢量扫描包含超过半线宽的外描边与偏移阴影，不裁掉真实 Alpha',async()=>{
  const layer=createImageEditPathLayerV3('vector','描边')
  layer.content.paint.strokes=[{enabled:true,color:layer.content.paint.fill.color,width:30,position:'outside'}]
  layer.content.paint.shadows=[{enabled:true,color:layer.content.paint.fill.color,opacity:1,angle:180,distance:80,size:20,blur:0}]
  const dispose=vi.spyOn(ImageEditorVectorRasterClientV3.prototype,'dispose').mockImplementation(()=>undefined)
  vi.spyOn(ImageEditorVectorRasterClientV3.prototype,'rasterize').mockImplementation(async(_node,_document,region)=>{
    const data=new Uint8ClampedArray(region.width*region.height*4)
    for(const [x,y]of [[-29,10],[-129,10],[10,10]]){
      if(x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height)data[((y-region.y)*region.width+x-region.x)*4+3]=255
    }
    return {width:region.width,height:region.height,data,colorSpace:'srgb'}
  })
  const points=await measureImageLayoutLayer(createImageEditDocumentV3({documentId:'vector-layout',width:1000,height:600}),layer,new AbortController().signal)
  expect(bounds(points,[1,0,0,1,0,0])).toEqual([-129,11,10,11])
  expect(dispose).toHaveBeenCalledOnce()
})
it('文字扫描包含大背景、基线偏移与阴影，保留正式栅格 Alpha 而非文字框边缘',async()=>{
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({font:'',measureText:(text:string)=>({width:text.length*10,actualBoundingBoxLeft:2,actualBoundingBoxRight:text.length*10+2,actualBoundingBoxAscent:10,actualBoundingBoxDescent:3})})})})
  const layer=createImageEditTextLayerV3('text','文字'),style=layer.content.paragraphs[0].runs[0].style
  style.fontSize=12;style.baselineShift=100;style.background.enabled=true;style.background.padding=120
  style.strokes=[{enabled:true,color:style.fill.color,width:60,position:'outside'}]
  style.shadows=[{enabled:true,color:style.fill.color,opacity:1,angle:180,distance:100,size:0,blur:0}]
  vi.spyOn(ImageEditorVectorRasterClientV3.prototype,'dispose').mockImplementation(()=>undefined)
  vi.spyOn(ImageEditorVectorRasterClientV3.prototype,'rasterize').mockImplementation(async(_node,_document,region)=>{
    const data=new Uint8ClampedArray(region.width*region.height*4),x=-100,y=-210
    if(x>=region.x&&x<region.x+region.width&&y>=region.y&&y<region.y+region.height)data[((y-region.y)*region.width+x-region.x)*4+3]=255
    return {width:region.width,height:region.height,data,colorSpace:'srgb'}
  })
  const points=await measureImageLayoutLayer(createImageEditDocumentV3({documentId:'text-layout',width:1000,height:600}),layer,new AbortController().signal)
  expect(bounds(points,[1,0,0,1,0,0])).toEqual([-100,-99,-210,-209])
})
