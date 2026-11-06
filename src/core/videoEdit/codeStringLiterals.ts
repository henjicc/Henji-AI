/** 源码里的一个字符串字面量：`start`/`end` 含引号，`value` 是解码后的文字。 */
export interface CodeStringLiteral { start: number; end: number; value: string; quote: '"' | "'" | '`' }

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }

/**
 * 列出源码里的字符串字面量，跳过注释；模板字符串只收不含 `${}` 的。不做完整的语法分析：正则字面量里的引号可能被误认，
 * 所以调用方只在画出来的字恰好对上唯一一处字面量时才改源码。
 */
export function codeStringLiterals(source: string): CodeStringLiteral[] {
  const result: CodeStringLiteral[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index], next = source[index + 1]
    if (char === '/' && next === '/') { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue }
    if (char === '/' && next === '*') { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue }
    if (char !== '"' && char !== "'" && char !== '`') { index++; continue }
    let value = '', at = index + 1, interpolated = false
    while (at < source.length && source[at] !== char) {
      const current = source[at]
      if (current === '\\') {
        const escaped = source[at + 1] ?? ''
        if (escaped === 'u' && source[at + 2] === '{') { const close = source.indexOf('}', at); value += String.fromCodePoint(parseInt(source.slice(at + 3, close), 16) || 0); at = close + 1; continue }
        if (escaped === 'u') { value += String.fromCharCode(parseInt(source.slice(at + 2, at + 6), 16) || 0); at += 6; continue }
        if (escaped === 'x') { value += String.fromCharCode(parseInt(source.slice(at + 2, at + 4), 16) || 0); at += 4; continue }
        if (escaped === '\r' || escaped === '\n') { at += escaped === '\r' && source[at + 2] === '\n' ? 3 : 2; continue }
        value += ESCAPES[escaped] ?? escaped; at += 2; continue
      }
      if (char === '`' && current === '$' && source[at + 1] === '{') {
        interpolated = true
        // 插值里可能还有字符串和花括号：按深度跳到配对的右括号。
        let depth = 0
        for (at += 1; at < source.length; at++) { if (source[at] === '{') depth++; else if (source[at] === '}' && --depth === 0) break }
        at++; continue
      }
      if (char !== '`' && current === '\n') break
      value += current; at++
    }
    if (source[at] === char && !interpolated) result.push({ start: index, end: at + 1, value, quote: char })
    index = at + 1
  }
  return result
}

/** 按原引号写出字面量。 */
export function codeStringLiteralSource(value: string, quote: CodeStringLiteral['quote']): string {
  let body = value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)
  body = quote === '`' ? body.replace(/\$\{/g, '\\${') : body.replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  return quote + body + quote
}

/** 从开括号起按深度找到配对的闭括号，跳过字符串。 */
function closing(source: string, open: number, literals: readonly CodeStringLiteral[]): number | undefined {
  const pair: Record<string, string> = { '{': '}', '[': ']' }, left = source[open], right = pair[left]
  let depth = 0
  for (let at = open; at < source.length; at++) {
    const literal = literals.find(item => item.start === at)
    if (literal) { at = literal.end - 1; continue }
    if (source[at] === left) depth++
    else if (source[at] === right && --depth === 0) return at + 1
  }
  return undefined
}
/** `export const textFonts = { text: [...] }` 里 text 数组的范围：那只是预载字形用的清单。字体族名等其他字段不算。 */
function textFontsTextRange(source: string): [number, number] | undefined {
  const match = /export\s+const\s+textFonts\s*=\s*\{/.exec(source)
  if (!match) return undefined
  const literals = codeStringLiterals(source), end = closing(source, match.index + match[0].length - 1, literals)
  if (end === undefined) return undefined
  const text = /\btext\s*:\s*\[/g
  text.lastIndex = match.index
  for (let found = text.exec(source); found && found.index < end; found = text.exec(source)) {
    if (literals.some(literal => literal.start <= found!.index && found!.index < literal.end)) continue
    const open = found.index + found[0].length - 1, close = closing(source, open, literals)
    if (close !== undefined && close <= end) return [open, close]
  }
  return undefined
}

/**
 * 把唯一一处值为 `before` 的字面量改成 `after`；没有或不止一处时返回 undefined。`textFonts` 里同文的预载清单不算出处，
 * 但一起改掉，新字的字形才会被预载。
 */
export function replaceUniqueCodeStringLiteral(files: Readonly<Record<string, string>>, before: string, after: string): Array<{ path: string; source: string }> | undefined {
  const matches = Object.entries(files).flatMap(([path, source]) => {
    const fonts = textFontsTextRange(source)
    return codeStringLiterals(source).filter(literal => literal.value === before).map(literal => ({ path, literal, preload: !!fonts && literal.start >= fonts[0] && literal.end <= fonts[1] }))
  })
  if (matches.filter(match => !match.preload).length !== 1) return undefined
  return [...new Set(matches.map(match => match.path))].map(path => {
    let source = files[path]
    for (const { literal } of matches.filter(match => match.path === path).sort((a, b) => b.literal.start - a.literal.start)) source = source.slice(0, literal.start) + codeStringLiteralSource(after, literal.quote) + source.slice(literal.end)
    return { path, source }
  })
}
