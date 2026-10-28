
import { cssFontFamily } from '../../fonts/catalog'
import { defaultTextStyle } from './text'
import { createTextLinePlan, legacyTextPlanGlyphs, TextDrawPlanError, type TextPlanMeasure } from './textDrawPlan'
export interface CodeTextLayout {width:number;height:number;lines:string[];lineWidths?:number[];baselineOffset?:number;fontSize:number;font:string;missingFont?:string;glyphs:{text:string;x:number;y:number;width:number}[]}
export interface CodeTextMeasureRequest {text:string;fontFamily:string;fontWeight:number;fontStyle:string;fontSize:number;letterSpacing:number;lineHeight:number;maxWidth:number;wrap:boolean;maxLines:number}
export interface CodeTextLayoutOptions { alphabeticPlacement: 'em' | 'font'; missingFont?: string }
export class TextLayoutError extends Error {constructor(readonly code:'BUDGET'|'CONTEXT',message:string){super(message)}}
// 作者默认值与文档、字体加载无关；每次布局只覆盖请求字段，无需重复解析相同 schema。
const codeTextBaseStyle = defaultTextStyle(720)

export function codeFont(request: CodeTextMeasureRequest): string {
  const family = cssFontFamily(request.fontFamily)
  return `${request.fontStyle} ${request.fontWeight} ${request.fontSize}px ${family}`
}
/** 旧作者 DTO 保留词换行、固定像素字距和前缀塑形，几何与字号搜索只由共享计划计算。 */
export function layoutCodeText(request: CodeTextMeasureRequest, measureText: TextPlanMeasure, options: CodeTextLayoutOptions): CodeTextLayout {
  if (![request.fontSize, request.fontWeight, request.letterSpacing, request.lineHeight, request.maxWidth, request.maxLines].every(Number.isFinite) || request.fontSize < 1 || request.lineHeight <= 0 || request.maxWidth < 0 || !Number.isInteger(request.maxLines) || request.maxLines < 0) throw new TextLayoutError('BUDGET', '文字布局参数无效或超过字形技术范围。')
  const style = { ...codeTextBaseStyle, fontFamily: request.fontFamily, fontWeight: request.fontWeight, fontStyle: request.fontStyle as 'normal' | 'italic' | 'oblique', fontSize: request.fontSize, leading: request.fontSize * request.lineHeight, align: 'left' as const, verticalAlign: 'top' as const }
  const measure: TextPlanMeasure = (text, font, state) => {
    const value = measureText(text, font, state)
    const width = typeof value === 'number' ? value : value.width
    if (Number.isFinite(width) && width < 0) throw new TextLayoutError('BUDGET', '文字推进宽度小于零。')
    return value
  }
  try {
    const plan = createTextLinePlan(request.text, style, {
      wrap: request.wrap ? 'word' : 'none', wrapWidth: request.wrap && request.maxWidth ? request.maxWidth : undefined,
      maxWidth: request.maxWidth || undefined, maxLines: request.maxLines || undefined, trim: true, minimumWidth: 'zero',
      baseline: 'alphabetic', alphabeticPlacement: options.alphabeticPlacement, fontKerning: 'auto', letterSpacing: request.letterSpacing, truncate: false,
      fit: { minFontSize: 1, maxFontSize: request.fontSize, algorithm: 'continuous', iterations: 12, trigger: 'maxLines' },
    }, measure)
    if (plan.fit.error) throw new TextLayoutError(plan.fit.error.code, '最小 1px 字号仍无法满足 maxLines/maxWidth。')
    return { width: plan.contentSize.width, height: plan.contentSize.height, lines: plan.lines.map(line => line.text), lineWidths: plan.lines.map(line => line.width), baselineOffset: plan.baselineOffset, fontSize: plan.style.fontSize, font: codeFont({ ...request, fontSize: plan.style.fontSize }), glyphs: legacyTextPlanGlyphs(plan, measure), ...(options.missingFont ? { missingFont: options.missingFont } : {}) }
  } catch (cause) {
    if (cause instanceof TextDrawPlanError) throw new TextLayoutError(cause.code, cause.message)
    throw cause
  }
}
