/**
 * check:icons 规则 C：界面文字不得用 emoji 或 ✓ ✗ ▶ 等符号字符充当图标或状态标记。
 * 界面图标只能用 lucide-react（确属图形才用 SVG）；emoji 只允许出现在开发者控制台输出里。
 *
 * 判定范围（码位）：
 *   - U+1F000–U+1FAFF：emoji（含 🔒 🚀 ✅ 的彩色版本、旗帜、杂项符号与象形图）
 *   - U+2600–U+27BF：杂项符号与装饰符号（☀ ★ ☆ ⚠ ✂ ✓ ✔ ✗ ✘ ❌ ➜ …）
 *   - U+2B50、U+2B55：⭐ ⭕
 *   - U+23E9–U+23FA：⏩ ⏳ ⏱ ⏸ ⏹ ⏺ 等媒体控制符号
 *   - U+25A0–U+25FF：几何图形（■ □ ▲ ▶ ◀ ◆ ◇ ○ ● …，常被当作播放键、标记与状态点；界面重设计 3.5 并入，
 *     剪辑时间轴标记 ◆ 已改为 lucide Diamond）
 *   - U+2139：ℹ
 * 不在范围内的排版符号（— → · … 等）是文字，不是图标。
 *
 * 豁免：注释（// 与块注释，含 JSX 注释）；`console.*(...)` 所在行；行内或上一行含 `icon-token-allow` 的行。
 */

const SYMBOL_GLYPH_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{23E9}-\u{23FA}\u{25A0}-\u{25FF}\u{2139}]/u
const CONSOLE_CALL_PATTERN = /\bconsole\.(?:log|info|warn|error|debug|trace|group|groupCollapsed|table)\s*\(/
const ALLOW_COMMENT = 'icon-token-allow'

/** 把注释替换成等长空白（保留换行与列号），字符串里的 `//`（如 URL）不受影响。 */
function blankComments(source) {
  let out = ''
  let index = 0
  let quote = null
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote) {
      out += char
      if (char === '\\') { out += next ?? ''; index += 2; continue }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === '\'' || char === '`') { quote = char; out += char; index += 1; continue }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end < 0 ? source.length : end + 2
      out += source.slice(index, stop).replace(/[^\n]/g, ' ')
      index = stop
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      const stop = end < 0 ? source.length : end
      out += ' '.repeat(stop - index)
      index = stop
      continue
    }
    out += char
    index += 1
  }
  return out
}

/**
 * @param {string} source 源码或 JSON 文案
 * @param {{ json?: boolean }} [options] JSON 没有注释，跳过注释剥离
 * @returns {{ line: number, glyph: string, text: string }[]}
 */
function findSymbolGlyphs(source, options = {}) {
  const original = source.split(/\r?\n/)
  const scanned = (options.json ? source : blankComments(source)).split(/\r?\n/)
  const findings = []
  scanned.forEach((line, index) => {
    const match = line.match(SYMBOL_GLYPH_PATTERN)
    if (!match) return
    if (CONSOLE_CALL_PATTERN.test(original[index] ?? '')) return
    if ((original[index] ?? '').includes(ALLOW_COMMENT) || (original[index - 1] ?? '').includes(ALLOW_COMMENT)) return
    findings.push({ line: index + 1, glyph: match[0], text: (original[index] ?? '').trim().slice(0, 120) })
  })
  return findings
}

module.exports = { SYMBOL_GLYPH_PATTERN, blankComments, findSymbolGlyphs }
