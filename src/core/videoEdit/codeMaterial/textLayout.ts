import { CodeMaterialError } from './contract'
import type { CodeTextLayout, CodeTextMeasureRequest } from './contract'

export function codeFont(request: CodeTextMeasureRequest): string {
  const family = ['sans-serif', 'serif', 'monospace'].includes(request.fontFamily) ? request.fontFamily : `"${request.fontFamily.replace(/["\\\r\n]/g, '')}", sans-serif`
  return `${request.fontStyle} ${request.fontWeight} ${request.fontSize}px ${family}`
}
/** Shared numeric layout: the host supplies native advance measurement, never author callbacks. */
export function layoutCodeText(request: CodeTextMeasureRequest, advance: (text: string, font: string) => number, missingFont?: string): CodeTextLayout {
  if (request.text.length > 4096 || ![request.fontSize, request.fontWeight, request.letterSpacing, request.lineHeight, request.maxWidth, request.maxLines].every(Number.isFinite) || request.fontSize < 1 || request.fontSize > 1024 || request.lineHeight <= 0 || request.maxWidth < 0 || !Number.isInteger(request.maxLines) || request.maxLines < 0) throw new CodeMaterialError('BUDGET', '文字布局参数无效或超过字形技术范围。')
  const make = (fontSize: number): CodeTextLayout => {
    const font = codeFont({ ...request, fontSize })
    const widthOf = (text: string): number => {
      const result = advance(text, font) + Math.max(0, Array.from(text).length - 1) * request.letterSpacing
      if (!Number.isFinite(result)) throw new CodeMaterialError('CONTEXT', '字体度量无效。')
      if (result < 0) throw new CodeMaterialError('BUDGET', 'letterSpacing 使文字宽度小于零，请减小负字距。')
      return result
    }
    const lines: string[] = []
    for (const paragraph of request.text.split(/\r?\n/)) {
      if (!request.wrap || !request.maxWidth) { lines.push(paragraph.trimEnd()); continue }
      const tokens = paragraph.match(/[\p{Script=Latin}\p{N}_'’-]+[\t ]*|[^\r\n]/gu) ?? []
      let line = ''
      for (const token of tokens) {
        if (widthOf(line + token.trimEnd()) <= request.maxWidth) { line += token; continue }
        if (line.trimEnd()) { lines.push(line.trimEnd()); line = '' }
        if (widthOf(token.trimEnd()) <= request.maxWidth) { line = token.trimStart(); continue }
        for (const char of Array.from(token.trim())) {
          if (line && widthOf(line + char) > request.maxWidth) { lines.push(line.trimEnd()); line = '' }
          line += char
        }
      }
      lines.push(line.trimEnd())
    }
    const lineHeight = fontSize * request.lineHeight
    const glyphs: CodeTextLayout['glyphs'] = []
    let width = 0
    lines.forEach((line, row) => {
      width = Math.max(width, widthOf(line)); let prefix = ''; let previous = 0
      Array.from(line).forEach((char, index) => {
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
    if (best.lines.length > request.maxLines || request.maxWidth && best.width > request.maxWidth) throw new CodeMaterialError('BUDGET', '最小 1px 字号仍无法满足 maxLines/maxWidth。')
    result = best
  }
  return result
}
