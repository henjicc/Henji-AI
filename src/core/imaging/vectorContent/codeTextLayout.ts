
import { cssFontFamily } from '../../fonts/catalog'
import { defaultTextStyle } from './text'
import { layoutRichText } from './richText'
import { textWidth } from './metrics'
export interface CodeTextLayout {width:number;height:number;lines:string[];lineWidths?:number[];baselineOffset?:number;fontSize:number;font:string;missingFont?:string;glyphs:{text:string;x:number;y:number;width:number}[]}
export interface CodeTextMeasureRequest {text:string;fontFamily:string;fontWeight:number;fontStyle:string;fontSize:number;letterSpacing:number;lineHeight:number;maxWidth:number;wrap:boolean;maxLines:number}
export class TextLayoutError extends Error {constructor(readonly code:'BUDGET'|'CONTEXT',message:string){super(message)}}

export function codeFont(request: CodeTextMeasureRequest): string {
  const family = cssFontFamily(request.fontFamily)
  return `${request.fontStyle} ${request.fontWeight} ${request.fontSize}px ${family}`
}
/** Shared numeric layout: the host supplies native advance measurement, never author callbacks. */
export function layoutCodeText(request: CodeTextMeasureRequest, advance: (text: string, font: string) => number, missingFont?: string): CodeTextLayout {
  if (![request.fontSize, request.fontWeight, request.letterSpacing, request.lineHeight, request.maxWidth, request.maxLines].every(Number.isFinite) || request.fontSize < 1 || request.lineHeight <= 0 || request.maxWidth < 0 || !Number.isInteger(request.maxLines) || request.maxLines < 0) throw new TextLayoutError('BUDGET', '文字布局参数无效或超过字形技术范围。')
  const make = (fontSize: number): CodeTextLayout => {
    const font = codeFont({ ...request, fontSize })
    const style = {...defaultTextStyle(720),fontFamily:request.fontFamily,fontWeight:request.fontWeight,fontStyle:request.fontStyle as 'normal'|'italic'|'oblique',fontSize,tracking:request.letterSpacing/fontSize*1000,leading:fontSize*request.lineHeight}
    const measure = (text:string, font:string):number => { const result=advance(text,font);if(!Number.isFinite(result))throw new TextLayoutError('CONTEXT','字体度量无效。');return result }
    const widthOf = (text:string):number => { const result=textWidth(text,style,measure); if(result<0)throw new TextLayoutError('BUDGET','letterSpacing 使文字宽度小于零，请减小负字距。');return result }
    const rich = layoutRichText({box:{x:0,y:0,width:request.wrap?request.maxWidth:0,height:0},paragraphs:[{runs:[{text:request.text,style}],align:'left',direction:'ltr',spaceBefore:0,spaceAfter:0}]},measure,{sourceVersion:'code-text',time:{kind:'static'},referenceGrid:{width:request.maxWidth||1,height:1},quality:'final'},'word')
    const lines = rich.lines.map(line=>line.text.trim())
    const lineHeight = fontSize * request.lineHeight
    const glyphs: CodeTextLayout['glyphs'] = []
    let width = 0
    lines.forEach((line, row) => {
      width = Math.max(width, widthOf(line)); let prefix = ''; let previous = 0
      Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(line),segment=>segment.segment).forEach((char, index) => {
        prefix += char; const next = advance(prefix, font)
        glyphs.push({ text: char, x: previous + index * request.letterSpacing, y: row * lineHeight, width: next - previous }); previous = next
      })
    })
    return { width, height: lines.length * lineHeight, lines, lineWidths: lines.map(widthOf), baselineOffset: (lineHeight - fontSize) / 2 + fontSize * .8, fontSize, font, glyphs, ...(missingFont ? { missingFont } : {}) }
  }
  let result = make(request.fontSize)
  if (request.maxLines && (result.lines.length > request.maxLines || request.maxWidth > 0 && result.width > request.maxWidth)) {
    let low = 1; let high = request.fontSize; let best = make(low)
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2; const candidate = make(mid)
      if (candidate.lines.length <= request.maxLines && (!request.maxWidth || candidate.width <= request.maxWidth)) { best = candidate; low = mid } else high = mid
    }
    if (best.lines.length > request.maxLines || request.maxWidth && best.width > request.maxWidth) throw new TextLayoutError('BUDGET', '最小 1px 字号仍无法满足 maxLines/maxWidth。')
    result = best
  }
  return result
}
