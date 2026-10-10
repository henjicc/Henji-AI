import { composeAffine, inverseAffine, mapAffine, type Affine, type Point } from '@/core/imaging/transforms'
import { flattenVectorPath, layoutRichText, textAdvances, textCharacters, textFont, type VectorPaint } from '@/core/imaging/vectorContent'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditGroupLayerV3, ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageLayoutEntry } from '@/core/imageEdit/v3/layoutDraft'
import { findImageEditLayerLocationV3 } from '../editor/layerTreeV3'
import { resolveAnnotationOutputGeometryV3 } from '../editor/annotationGeometryV3'
import { imageEditV3LayerRef } from './imageEditDocumentRefs'
import { ensureVectorDocumentFonts } from '@/services/vectorContent/fonts'
import { ImageLayoutAlphaSupport, measureImageLayoutRaster } from './imageEditLayoutAlphaGeometry'
import { ImageEditorVectorRasterClientV3 } from '../execution/vectorRasterClientV3'

export type LayoutMeasure = (document: ImageEditDocumentV3, layer: ImageEditLayerV3, signal: AbortSignal, matrix?:Affine) => Promise<Point[]>
function assertLayoutGeometrySupported(layer:ImageEditLayerV3):void {
  if(layer.deformation)throw new Error('变形图层的可见边缘暂不能整理，请先栅格化该图层')
  if(layer.mask&&layer.maskAttachment.enabled)throw new Error('含蒙版图层的可见边缘暂不能整理，请先合并蒙版')
  if(layer.clipping||layer.filters.some(f=>f.enabled&&f.opacity>0))throw new Error('含剪贴或滤镜的图层暂不能按可见边缘整理，请先栅格化该图层')
}
const rectangle = (x: number, y: number, width: number, height: number): Point[] => [[x,y],[x+width,y],[x+width,y+height],[x,y+height]]
/** Conservative scan ROI only; appearance pixels still come from the formal rasterizer. */
function appearanceMargin(paint:VectorPaint):number {
  const stroke=paint.strokes.reduce((extent,s)=>Math.max(extent,s.enabled?s.width:0),0)
  return paint.shadows.reduce((extent,s)=>Math.max(extent,s.enabled&&s.opacity>0?stroke+s.distance+s.size+s.blur*4:0),stroke)
}
/** Shared rich-text shaping and path interpreter, with native font metrics; no center-only geometry. */
export async function measureImageLayoutLayer(document:ImageEditDocumentV3,layer:ImageEditLayerV3,signal:AbortSignal,matrix:Affine=[1,0,0,1,0,0],byteSizes:Readonly<Record<string,number>>={}):Promise<Point[]> {
  signal.throwIfAborted()
  assertLayoutGeometrySupported(layer)
  if (layer.type === 'raster' || layer.type === 'smart') {
    return measureImageLayoutRaster(layer,matrix,signal,byteSizes)
  }
  let points:Point[]=[]
  if (layer.type === 'text') {
    await ensureVectorDocumentFonts({ ...document, layers: [layer] }); signal.throwIfAborted()
    const context = globalThis.document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('文字尺寸尚未就绪，请重试')
    let glyphExtent=0
    const measure=(text:string,font:string):number=>{
      context.font=font;context.textBaseline='middle';context.textAlign='left'
      const metrics=context.measureText(text)
      glyphExtent=Math.max(glyphExtent,metrics.actualBoundingBoxLeft||0,(metrics.actualBoundingBoxRight||metrics.width)-metrics.width,metrics.actualBoundingBoxAscent||0,metrics.actualBoundingBoxDescent||0)
      return metrics.width
    }
    const layout = layoutRichText(layer.content, measure, {
      sourceVersion: `layout:${document.revision}`, time: { kind:'static' }, referenceGrid: document.geometry, quality:'final', signal,
    })
    points=layout.runs.flatMap(run => {
      const style=run.style,characters=textCharacters(run.text,style),advances=textAdvances(run.text,style,measure)
      let left=run.x,right=run.x+run.width,x=run.x
      for(const [index,character]of characters.entries()){
        left=Math.min(left,x);right=Math.max(right,x+measure(character.text,textFont(style,character.size)))
        x+=advances[index]
      }
      const glyphPad=Math.max(style.fontSize,glyphExtent)+(style.fauxItalic?style.fontSize*.4:0)
      const pad=Math.max(appearanceMargin(style),style.background.enabled?style.background.padding:0)+glyphPad
      const shift=-style.baselineShift+(style.superscript?-style.fontSize*.35:style.subscript?style.fontSize*.2:0)
      const top=Math.min(run.y,run.y+shift),bottom=Math.max(run.y+run.lineHeight,run.y+run.lineHeight+shift)
      return rectangle(left-pad,top-pad,right-left+2*pad,bottom-top+2*pad)
    })
  }
  if (layer.type === 'path' || layer.type === 'shape') {
    const pad=appearanceMargin(layer.content.paint)
    points=layer.content.operands.flatMap(o => flattenVectorPath(o.path, .01, signal).flatMap(contour => contour.flatMap(p => pad ? rectangle(p.x-pad,p.y-pad,2*pad,2*pad) : [[p.x,p.y] as Point])))
  }
  if(!points.length||!['text','shape','path'].includes(layer.type))throw new Error('请选择有画面内容的图层')
  const support=new ImageLayoutAlphaSupport(matrix),client=new ImageEditorVectorRasterClientV3()
  const bounds=points.reduce((box,p)=>[Math.min(box[0],p[0]),Math.min(box[1],p[1]),Math.max(box[2],p[0]),Math.max(box[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity])
  const left=Math.floor(bounds[0])-1,top=Math.floor(bounds[1])-1
  const right=Math.ceil(bounds[2])+1,bottom=Math.ceil(bounds[3])+1
  try {
    for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
      signal.throwIfAborted();const region={x,y,width:Math.min(512,right-x),height:Math.min(512,bottom-y)}
      const frame=await client.rasterize({parameters:{type:layer.type,content:layer.type==='text'||layer.type==='shape'||layer.type==='path'?layer.content:undefined}},document,region,0,signal)
      support.scan(frame.width,frame.height,i=>frame.data[i*4+3],x,y)
    }
    return support.result()
  } finally {client.dispose()}
}

export function resolveImageLayoutParentAffine(document:ImageEditDocumentV3,ancestors:readonly ImageEditGroupLayerV3[]):Affine {
  let parent:Affine=resolveAnnotationOutputGeometryV3(document).sourceToOutput
  for(const ancestor of ancestors)parent=composeAffine(parent,ancestor.transform)
  return parent
}
export async function captureImageLayoutEntries(document: ImageEditDocumentV3, ids: readonly string[], signal: AbortSignal,
  measure: LayoutMeasure = measureImageLayoutLayer): Promise<Omit<ImageLayoutEntry, 'sample'>[]> {
  const unique = new Set(ids)
  if (unique.size !== ids.length) throw new Error('随手摆目标重复')
  const entries: Omit<ImageLayoutEntry, 'sample'>[] = []
  const visit = async (layer: ImageEditLayerV3, matrix: Affine): Promise<Point[]> => {
    signal.throwIfAborted(); inverseAffine(matrix)
    assertLayoutGeometrySupported(layer)
    if (layer.type === 'group') {
      if(layer.children.some(child=>child.visible&&child.opacity>0&&(child.type==='effect'||child.type==='adjustment')))throw new Error('含整体效果的组暂不能按可见边缘整理，请先栅格化该组')
      const support=new ImageLayoutAlphaSupport([1,0,0,1,0,0])
      for (const child of layer.children) if (child.visible&&child.opacity>0&&child.fillOpacity>0&&child.type!=='effect'&&child.type!=='adjustment') for(const p of await visit(child,composeAffine(matrix,child.transform)))support.rectangle(p[0],p[1],0,0)
      return support.result()
    }
    return (await measure(document,layer,signal,matrix)).map(p => mapAffine(matrix,p))
  }
  const hasLockedChild = (layer: ImageEditLayerV3): boolean => layer.locked || layer.type === 'group' && layer.children.some(hasLockedChild)
  for (const id of ids) {
    signal.throwIfAborted()
    const location = findImageEditLayerLocationV3(document.layers,id)
    if (!location) throw new Error('图层已删除，请重新选择')
    if (location.ancestors.some(a => unique.has(a.id))) continue
    if (!location.layer.visible || location.layer.opacity<=0 || location.layer.fillOpacity<=0 || location.ancestors.some(a => !a.visible||a.opacity<=0||a.fillOpacity<=0)) throw new Error('请先显示要整理的图层')
    for(const ancestor of location.ancestors)assertLayoutGeometrySupported(ancestor)
    const parent=resolveImageLayoutParentAffine(document,location.ancestors)
    inverseAffine(parent); inverseAffine(location.layer.transform)
    const affine = composeAffine(parent,location.layer.transform)
    const points = await visit(location.layer,affine)
    if (!points.length) throw new Error('所选图层没有可整理的可见内容')
    entries.push({ layerId:id, localAffine:[...location.layer.transform], parentAffine:[...parent], item:{ targetRef:imageEditV3LayerRef(document.id,id), affine:[...affine],
      worldCorners:points.map(p => [p[0],p[1]]), translationLocked:hasLockedChild(location.layer)||location.ancestors.some(a=>a.locked) } })
  }
  if (entries.length < 3) throw new Error('请至少选择三个独立图层；组与其子图层算同一个目标')
  return entries
}
