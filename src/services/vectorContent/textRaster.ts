import { defaultTextStyle, textAlignmentAnchor, type TextContent } from '@/core/imaging/vectorContent/text'
import { createTextDrawPlan } from '@/core/imaging/vectorContent/textDrawPlan'
import { canvasTextPlanMeasure, paintTextDrawPlan } from '@/core/imaging/vectorContent/textDrawPlanCanvas'
import { paintVectorAppearance } from './appearance'

type Context = OffscreenCanvasRenderingContext2D
/** The native glyph operation is shared by rich text and both code-material generations. */
export function paintNativeText(context: Context, text: string, x: number, y: number, mode: 'fill' | 'stroke' = 'fill'): void {
  if (mode === 'stroke') context.strokeText(text, x, y)
  else context.fillText(text, x, y)
}
/** 计划负责所有文字几何，宿主只传入坐标和唯一外观合成器。 */
export function paintText(context: Context, clip: TextContent, width: number, height: number, origin = { x: width / 2, y: height / 2 }, resolution = 1): void {
  const style = clip.textStyle ?? defaultTextStyle(height)
  const plan = createTextDrawPlan(clip.text, style, { frame: { width, height }, anchor: textAlignmentAnchor(style), direction: context.direction ?? 'inherit' }, canvasTextPlanMeasure(context))
  paintTextDrawPlan(context, plan, { width, height, resolution, x: origin.x, y: origin.y }, paintVectorAppearance)
}

/** Integer power-of-two tiers keep continuous motion out of raster identity, without undersampling magnified text. */
export function textResolution(scale: number): number { return 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, scale)) - 1e-10)) }
export interface TextRaster { canvas: OffscreenCanvas; x: number; y: number; width: number; height: number }
/** Bounds are relative to the text origin, including glyph overhangs, shifted baselines and all appearance layers. */
export function rasterizeText(clip: TextContent, frame: { width: number; height: number }, resolution = 1): TextRaster {
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!
  const style = clip.textStyle ?? defaultTextStyle(frame.height)
  const origin = { x: frame.width / 2, y: frame.height / 2 }
  const plan = createTextDrawPlan(clip.text, style, { frame, anchor: textAlignmentAnchor(style, origin.x, origin.y), rasterOrigin: origin }, canvasTextPlanMeasure(probe))
  const { x, y, width, height } = plan.rasterBounds
  // 分配前执行 GPU 上传尺寸限制，避免先创建无法使用的临时纹理。
  if (width * resolution > 8192 || height * resolution > 8192) throw new Error('文字栅格超过 GPU 单张纹理 8192 像素技术范围。')
  const canvas = new OffscreenCanvas(Math.ceil(width * resolution), Math.ceil(height * resolution)); const context = canvas.getContext('2d')!
  if (resolution !== 1) context.scale(resolution, resolution)
  paintTextDrawPlan(context, plan, { width, height, resolution, x: -origin.x - x, y: -origin.y - y }, paintVectorAppearance)
  return { canvas, x, y, width, height }
}

export function paintMeasuredText(context:OffscreenCanvasRenderingContext2D,layout:import('@/core/imaging/vectorContent/codeTextLayout').CodeTextLayout,box:{x:number;y:number;width:number},lineHeight:number,align:'left'|'center'|'right',customSpacing:boolean,strokeWidth=0):void {
  context.font=layout.font;context.textBaseline='alphabetic';context.textAlign='left';
  const offset=(row:number)=>align==='center'?(box.width-(layout.lineWidths?.[row]??layout.width))/2:align==='right'?box.width-(layout.lineWidths?.[row]??layout.width):0;
  const paint=(text:string,x:number,y:number)=>{if(strokeWidth)paintNativeText(context,text,x,y,'stroke');paintNativeText(context,text,x,y)};
  if(customSpacing)for(const glyph of layout.glyphs)paint(glyph.text,box.x+glyph.x+offset(Math.round(glyph.y/lineHeight)),box.y+glyph.y+(layout.baselineOffset??lineHeight/2));
  else layout.lines.forEach((line,row)=>paint(line,box.x+offset(row),box.y+row*lineHeight+(layout.baselineOffset??lineHeight/2)));
}
