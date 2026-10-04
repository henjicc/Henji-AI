/**
 * 未定义颜色类扫描（check:colors 第四类规则，任务 5.8 / 5.4 转交）。
 *
 * `bg-overlay`、`text-error`、`bg-selected-accent/50` 这类类名 Tailwind 不生成任何样式：
 * 颜色名不在 tailwind.config.js 里，或令牌是自带透明度的完整颜色（cssVar）却加了 `/50` 透明度修饰。
 * 界面上表现为“没有底色 / 文字是继承色”，静态检查和类型检查都看不见。
 *
 * 判定以 Tailwind 实际配置为准：用 tailwindcss 自己的 createContext + generateRules 生成，零条规则即未定义。
 * 只看颜色类前缀（bg / text / border / ring / from / to / via / fill / stroke / outline / divide / placeholder /
 * decoration / shadow / accent / caret），且只看“像类名列表”的字符串，避免把 'text-align'、'border-color'
 * 这类 CSS 属性名或业务键名当成类名：
 *   - 紧跟在 className= / class= / *Class(Name) = / *_CLASS = 之后的字符串；
 *   - 或至少两个词、且至少一半是 Tailwind 能生成或样式表里定义过的类。
 */
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const COLOR_CLASS_PREFIX = '(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|from|to|via|fill|stroke|outline|divide(?:-[xy])?|placeholder|decoration|shadow|accent|caret)'
/** 一个词是不是颜色前缀的工具类（允许任意变体与 ! 前缀）。 */
const COLOR_CLASS_TOKEN = new RegExp(`^(?:(?:[\\w-]+|\\[[^\\]]+\\]):)*!?-?${COLOR_CLASS_PREFIX}-[\\w./\\[\\]()%#,-]+$`)
const CLASS_LIKE_TOKEN = /^(?:(?:[\w-]+|\[[^\]]+\]):)*!?-?[a-z][\w./[\]()%#:,'-]*$/
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
const CLASS_CONTEXT = /(?:\bclass(?:Name)?\s*=\s*\{?\s*|\b\w*(?:Class|ClassName|CLASS)\w*\s*[:=]\s*(?:\{\s*)?(?:\w+\s*\?\s*)?)$/

/**
 * 从源码里取“像类名列表”的字符串中的颜色类候选。
 * @param {(token: string) => boolean} isKnownClass Tailwind 能生成或样式表定义过
 * @returns {{ token: string, line: number }[]}
 */
function extractColorClassCandidates(text, isKnownClass) {
  const results = []
  const lines = text.split(/\r?\n/)
  const lineStarts = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const lineAt = (index) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid] <= index) low = mid
      else high = mid - 1
    }
    return low + 1
  }
  for (const match of text.matchAll(STRING_LITERAL)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    const line = lineAt(match.index)
    const lineText = lines[line - 1] ?? ''
    if (/^\s*(\/\/|\/\*|\*)/.test(lineText)) continue
    const body = raw.replace(/\$\{[^}]*\}/g, ' ')
    const tokens = body.split(/\s+/).filter(Boolean)
    const candidates = tokens.filter((token) => COLOR_CLASS_TOKEN.test(token))
    if (!candidates.length) continue
    const before = text.slice(Math.max(0, match.index - 80), match.index)
    const classContext = CLASS_CONTEXT.test(before)
    if (!classContext) {
      if (tokens.length < 2 || !tokens.every((token) => CLASS_LIKE_TOKEN.test(token))) continue
      const known = tokens.filter((token) => isKnownClass(token)).length
      if (known * 2 < tokens.length) continue
    }
    for (const token of candidates) results.push({ token, line })
  }
  return results
}

/**
 * 按 Tailwind 实际配置建一个“这个类会不会生成样式”的判定器。
 * @param {string} projectRoot
 * @param {Iterable<string>} cssClassNames 样式表里定义的类（Tailwind 上下文看不到）
 */
async function createTailwindClassProbe(projectRoot, cssClassNames = []) {
  const requireFromRoot = require('node:module').createRequire(path.join(projectRoot, 'package.json'))
  const resolveConfig = requireFromRoot('tailwindcss/resolveConfig')
  const { createContext } = requireFromRoot('tailwindcss/lib/lib/setupContextUtils')
  const { generateRules } = requireFromRoot('tailwindcss/lib/lib/generateRules')
  const config = (await import(pathToFileURL(path.join(projectRoot, 'tailwind.config.js')).href)).default
  const context = createContext(resolveConfig(config))
  const cssClasses = new Set(cssClassNames)
  const cache = new Map()
  return (token) => {
    if (cache.has(token)) return cache.get(token)
    const bare = token.replace(/^(?:(?:[\w-]+|\[[^\]]+\]):)*!?/, '')
    let generated = cssClasses.has(bare)
    if (!generated) {
      try {
        generated = generateRules(new Set([token]), context).length > 0
      } catch {
        generated = false
      }
    }
    cache.set(token, generated)
    return generated
  }
}

module.exports = {
  COLOR_CLASS_TOKEN,
  createTailwindClassProbe,
  extractColorClassCandidates,
}
