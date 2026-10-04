/**
 * 旧界面代码残留的统计规则（skill henji-ui-surface references/review.md 第 3 节“代码残留”）。
 * 本文件只有纯函数：给文本出命中，给路径出区域；读文件、汇总与出报告在 scripts/ui-residue-scan.cjs。
 *
 * 现在是报告模式（任务 5.2）；5.8 清零后把需要的类别接进构建门禁。正则与 5.1 盘点第二节一致。
 */
const path = require('node:path')

/** 与 scripts/check-color-tokens.cjs 的 UTILITY_PREFIX / LEGACY_ALIAS_COLOR_NAMES 一致（精确测试比对两处文本）。 */
const COLOR_UTILITY_PREFIX = '(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|divide|placeholder|decoration|shadow|accent|caret)'
const LEGACY_ALIAS_COLOR_NAMES =
  'bg-dark|bg|surface-dark|surface|border-dark|border|app|layer|brand-\\d{3}|text-dark|text|text-muted(?:-dark)?|text-soft(?:-dark)?|text-faint(?:-dark)?|danger|success|warning'

const LEGACY_ALIAS_PATTERN = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*!?-?${COLOR_UTILITY_PREFIX}-(?:${LEGACY_ALIAS_COLOR_NAMES})(?:\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]]+\\]))?(?![\\w-])`,
  'g',
)
const LEGACY_CSS_VAR_PATTERN =
  /--(?:app|bg|surface|layer|border|text|text-soft|text-muted|text-faint|brand-\d{3})-rgb\b|--ui-(?:surface-panel|surface-field|border-soft|border-strong)\b/g

/** 5.1 第二节的任意值类正则（`h-[37px]`、`text-[13px]`、`rounded-[10px]` …）。 */
const ARBITRARY_VALUE_PATTERN = new RegExp(
  '(?<![\\w-])(?:[\\w-]+:)*!?-?(?:text|h|w|size|min-w|max-w|min-h|max-h|p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy]'
  + '|top|left|right|bottom|inset(?:-[xy])?|rounded(?:-[a-z]+)?|leading|tracking|basis|translate-[xy]|z|shadow'
  + '|border(?:-[trblxy])?|duration|delay|blur|backdrop-blur|opacity|bg|from|to|via|ring|outline)-\\[[^\\]\\s]+\\]',
  'g',
)
const PX_VALUE_PATTERN = /\[-?\d+(?:\.\d+)?px\]/

const INLINE_STYLE_PATTERN = /style=\{\{([\s\S]*?)\}\}/g
const INLINE_STYLE_COLOR_KEYS = /\b(?:color|background|backgroundColor|borderColor|fill|stroke|boxShadow|outlineColor|caretColor)\s*:/
const INLINE_STYLE_SIZE_KEYS =
  /\b(?:width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|lineHeight|padding\w*|margin\w*|borderRadius|gap)\s*:/

/** 调用点覆盖外观：Ui* 组件（以及 Dropdown / PanelTrigger 的 buttonClassName）的类串里出现外观类。 */
const APPEARANCE_CLASS_PATTERN = new RegExp(
  '(?<![\\w-])(?:[\\w-]+:)*!?(?:bg-[\\w/.[\\]-]+|border(?:-[\\w/.[\\]-]+)?|rounded(?:-[\\w[\\].-]+)?|shadow(?:-[\\w[\\].-]+)?'
  + '|ring(?:-[\\w/.[\\]-]+)?|backdrop-[\\w[\\].-]+|text-(?:text\\d|accent[\\w-]*|on-[\\w-]+|[a-z]+-text|\\[[^\\]]+\\]|xs|sm|base|lg|xl|\\d?xl))(?![\\w-])',
  'g',
)
const CLASS_LITERAL_PATTERN = /\b(className|buttonClassName)=(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*["']([^"']*)["']\s*\})/g
const OPENING_TAG_PATTERN = /<([A-Za-z][\w.]*)\b/g

const SURFACE_ALLOW_PATTERN = /ui-surface-allow(?!-file)/
const LEGACY_COPY_TERMS = Object.freeze(['工具箱'])

/**
 * 门禁口径（5.8，写进 skill references/review.md 第 3 节）。每条命中得到一个判定：
 *   - violation：必须改掉，不可登记；
 *   - register：只有在 scripts/ui-residue.allowlist.json 登记了理由才放行；
 *   - allowed：按口径本来就合规，只出现在报告里（附口径名）；
 *   - info：报告视图，不参与门禁（arbitraryPx 是 arbitraryValue 的子视图）。
 */
const RESIDUE_CATEGORIES = Object.freeze([
  { key: 'legacyAlias', label: '旧 Tailwind 别名类', gate: '违规（check:colors legacy 同源）' },
  { key: 'legacyCssVar', label: '旧 CSS 变量', gate: '违规（check:colors 硬性规则同源）' },
  { key: 'arbitraryValue', label: '任意值类', gate: '变量/相对值合规；视觉档位与标准档等值违规；固定几何尺寸登记' },
  { key: 'arbitraryPx', label: '任意值类（写死 px）', gate: '报告视图（门禁按任意值类判）' },
  { key: 'inlineStyleColor', label: '内联 style 含颜色', gate: '运行时数据与令牌变量合规；字面量颜色违规' },
  { key: 'inlineStyleSize', label: '内联 style 含尺寸', gate: '运行时计算值合规；字面量尺寸改类名或登记' },
  { key: 'appearanceOverride', label: '调用点覆盖组件外观', gate: '违规；确属表面语义差异时用标签内 ui-surface-allow' },
  { key: 'surfaceAllow', label: 'ui-surface-allow 行级豁免', gate: '必须写理由（≥ 8 字）；逐条复核' },
  { key: 'colorAllowlist', label: 'check:colors 登记项', gate: 'check:colors 登记文件（只能下调）' },
  { key: 'privateCssVar', label: '组件私有 CSS 变量', gate: '第三方库变量映射合规；其余登记' },
  { key: 'privateCssLiteral', label: '组件私有 CSS 写死尺寸', gate: '登记' },
  { key: 'privateCssClass', label: '使用私有 CSS 类', gate: '按类名登记（画布 LOD/性能机制、伪元素与第三方主题）' },
  { key: 'unusedCssClass', label: '零引用 CSS 类', gate: '违规（删除）' },
  { key: 'deadCode', label: '零引用源文件', gate: '违规（删除）' },
  { key: 'testOnlyCode', label: '仅测试引用的源文件', gate: '违规（删除或接回正式代码）' },
  { key: 'legacyCopy', label: '旧文案', gate: '违规' },
])

const VERDICT_BY_CATEGORY = Object.freeze({
  legacyAlias: 'violation',
  legacyCssVar: 'violation',
  arbitraryPx: 'info',
  appearanceOverride: 'violation',
  colorAllowlist: 'allowed',
  privateCssLiteral: 'register',
  privateCssClass: 'register',
  unusedCssClass: 'violation',
  deadCode: 'violation',
  testOnlyCode: 'violation',
  legacyCopy: 'violation',
})

/** Tailwind 3.4 默认间距档（px）：几何类的任意值与其中一档等值时必须写标准类。 */
const SPACING_SCALE_PX = Object.freeze([1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96,
  112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384])
const GEOMETRY_UTILITY = /^(?:h|w|size|min-w|max-w|min-h|max-h|basis|top|left|right|bottom|inset(?:-[xy])?|translate-[xy])$/
const COLOR_ARBITRARY_UTILITY = /^(?:bg|from|to|via|ring|outline)$/
/** 依赖容器、视口或字号的相对值：固定档位表达不了。 */
const RELATIONAL_VALUE = /%|\d(?:vw|vh|dvh|svh|lvh|vmin|vmax|(?<!r)em|lh|cqw|cqh|cqi|cqb|ch)\b|^(?:calc|min|max|clamp)\(/
const VARIABLE_VALUE = /^var\(--[\w-]+(?:,[^)]*)?\)$/
const NATIVE_CONTROL_PART_VARIANT = /::-(?:webkit-slider-thumb|moz-range-thumb|webkit-slider-runnable-track|moz-range-track)\]:/

/**
 * 任意值类的判定（token 形如 `hover:!-mt-[3px]`）。
 * @returns {{ verdict: 'allowed'|'register'|'violation', rule: string, value: string }}
 */
function classifyArbitraryValue(token) {
  const match = /^(?:(?:[\w-]+|\[[^\]]+\]):)*!?(-?)([a-z][a-z-]*?)-\[([^\]]+)\]$/.exec(token)
  if (!match) return { verdict: 'violation', rule: '无法解析的任意值类', value: token }
  const [, negative, utility, raw] = match
  const value = `${negative}${utility}-[${raw}]`
  const inner = raw.replace(/^(?:length|color|number):/, '')
  if (VARIABLE_VALUE.test(inner)) return { verdict: 'allowed', rule: '引用变量（主题令牌或运行时写入）', value }
  if (/^(?:inherit|auto|none|currentColor)$/.test(inner)) return { verdict: 'allowed', rule: 'CSS 关键字', value }
  if (COLOR_ARBITRARY_UTILITY.test(utility) || (utility === 'text' && !/^-?\d/.test(inner))) {
    return { verdict: 'violation', rule: '任意颜色值：改用语义令牌类', value }
  }
  if (RELATIONAL_VALUE.test(inner)) return { verdict: 'allowed', rule: '相对值（容器、视口或字号）', value }
  // 原生控件部件（滑块拇指、轨道）的外边距是部件几何（拇指相对轨道居中），不是排版间距
  const nativePart = NATIVE_CONTROL_PART_VARIANT.test(token) && /^m[xytrbl]?$/.test(utility)
  if (!GEOMETRY_UTILITY.test(utility) && !nativePart) {
    return { verdict: 'violation', rule: '视觉档位（字号/行高/圆角/间距/层级/动效/阴影）写死：改用令牌类', value }
  }
  const fixed = /^(-?\d+(?:\.\d+)?)(px|rem)$/.exec(inner)
  if (fixed) {
    const px = Math.abs(Number(fixed[1]) * (fixed[2] === 'rem' ? 16 : 1))
    if (SPACING_SCALE_PX.includes(px)) return { verdict: 'violation', rule: `与标准档等值（${px}px）：写标准类`, value }
  }
  return { verdict: 'register', rule: '固定几何尺寸：登记理由', value }
}

/** 顶层逗号切分对象字面量的条目（跳过括号、模板与字符串里的逗号）。 */
function splitTopLevel(body, separator = ',') {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === separator && depth === 0) {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

/** 三元表达式的结果分支（没有三元就是整个值）。 */
function resultBranches(value) {
  const question = splitTopLevel(value, '?')
  if (question.length < 2) return [value.trim()]
  return question.slice(1).flatMap((part) => splitTopLevel(part, ':')).map((part) => part.trim())
}

/** 写死的尺寸：数字字面量，或只由数字与 px/rem 组成的字符串（含 `'10px 10px 8px'` 这类简写）；全 0 不算。 */
const LITERAL_SIZE_BRANCH = /^(?:-?\d*\.?\d+|['"](?:\s*-?\d*\.?\d+(?:px|rem)?)+\s*['"])$/
const ZERO_BRANCH = /^(?:0|['"](?:\s*0(?:px)?)+\s*['"])$/
const LITERAL_COLOR_BRANCH = /^['"`](?![^'"`]*var\()(?!transparent|currentColor|inherit)[^'"`$]+['"`]$/

/**
 * 内联 style 里写死的尺寸 / 颜色条目。值是运行时计算（变量、函数、模板插值）的不算。
 * @returns {{ sizes: string[], colors: string[] }}
 */
function inlineStyleLiterals(body) {
  const sizes = []
  const colors = []
  for (const entry of splitTopLevel(body.replace(/\/\/[^\n]*/g, ''))) {
    const pair = /^\s*([A-Za-z]+)\s*:\s*([\s\S]+?)\s*$/.exec(entry)
    if (!pair) continue
    const [, key, value] = pair
    const branches = resultBranches(value)
    if (INLINE_STYLE_SIZE_KEYS.test(`${key}:`) && branches.some((branch) => LITERAL_SIZE_BRANCH.test(branch) && !ZERO_BRANCH.test(branch))) {
      sizes.push(`${key}: ${value.replace(/\s+/g, ' ')}`)
    }
    if (INLINE_STYLE_COLOR_KEYS.test(`${key}:`) && branches.some((branch) => LITERAL_COLOR_BRANCH.test(branch))) {
      colors.push(`${key}: ${value.replace(/\s+/g, ' ')}`)
    }
  }
  return { sizes, colors }
}

/** 豁免注释的理由：标记之后去掉标点与注释符号至少 8 个字。 */
function surfaceAllowHasReason(line) {
  const after = line.slice(line.indexOf('ui-surface-allow') + 'ui-surface-allow'.length)
  return after.replace(/[\s:：*/{}"'`,，。.()（）-]/g, '').length >= 8
}

function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*)/.test(line)
}

function lineNumberAt(text, index) {
  let line = 1
  for (let cursor = text.indexOf('\n'); cursor !== -1 && cursor < index; cursor = text.indexOf('\n', cursor + 1)) line += 1
  return line
}

/** 最近的未闭合 JSX 开始标签（只看 className 之前的文本，够报告用）。index 是标签起点在全文里的位置。 */
function enclosingTag(text, index) {
  const offset = Math.max(0, index - 1200)
  const before = text.slice(offset, index)
  let match
  let last = null
  OPENING_TAG_PATTERN.lastIndex = 0
  while ((match = OPENING_TAG_PATTERN.exec(before))) last = { name: match[1], index: match.index }
  if (!last) return null
  // 中间已经出现了标签结束（`>` 后跟换行/标签），说明 className 不属于这个标签
  const between = before.slice(last.index)
  if (/(^|[^=])>\s*(\n|<|\{)/.test(between.replace(/=>/g, '=='))) return null
  return { name: last.name, index: offset + last.index }
}

function enclosingTagName(text, index) {
  return enclosingTag(text, index)?.name ?? null
}

/**
 * 扫描一个 ts/tsx 源文件的文本。
 * @returns {{ category: string, line: number, text: string }[]}
 */
function finding(category, line, text, extra = {}) {
  return { category, line, text, verdict: VERDICT_BY_CATEGORY[category] ?? 'violation', rule: '', value: text, ...extra }
}

function scanSourceText(text) {
  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const lineNo = index + 1
    if (SURFACE_ALLOW_PATTERN.test(line)) {
      const reasoned = surfaceAllowHasReason(line)
      findings.push(finding('surfaceAllow', lineNo, line.trim().slice(0, 160), {
        verdict: reasoned ? 'allowed' : 'violation', rule: reasoned ? '行级豁免已写理由' : '行级豁免缺理由（≥ 8 字）',
      }))
    }
    if (isCommentLine(line)) return
    for (const match of line.matchAll(LEGACY_ALIAS_PATTERN)) findings.push(finding('legacyAlias', lineNo, match[0]))
    for (const match of line.matchAll(LEGACY_CSS_VAR_PATTERN)) findings.push(finding('legacyCssVar', lineNo, match[0]))
    for (const match of line.matchAll(ARBITRARY_VALUE_PATTERN)) {
      // 判定要看完整类名：任意变体（`[&::-webkit-slider-thumb]:`）在正则命中之前
      const variants = /[^\s"'`{}]*$/.exec(line.slice(0, match.index))[0]
      findings.push(finding('arbitraryValue', lineNo, match[0], classifyArbitraryValue(`${variants}${match[0]}`)))
      if (PX_VALUE_PATTERN.test(match[0])) findings.push(finding('arbitraryPx', lineNo, match[0]))
    }
    if (isLegacyCopyLine(line)) {
      for (const term of LEGACY_COPY_TERMS) {
        if (line.includes(term)) findings.push(finding('legacyCopy', lineNo, line.trim().slice(0, 160)))
      }
    }
  })
  for (const match of text.matchAll(INLINE_STYLE_PATTERN)) {
    const body = match[1]
    const lineNo = lineNumberAt(text, match.index)
    if (isCommentLine(lines[lineNo - 1] ?? '')) continue
    const snippet = match[0].replace(/\s+/g, ' ').slice(0, 160)
    const literals = inlineStyleLiterals(body)
    if (INLINE_STYLE_COLOR_KEYS.test(body)) {
      findings.push(finding('inlineStyleColor', lineNo, snippet, literals.colors.length
        ? { verdict: 'violation', rule: '字面量颜色：改用语义令牌类', value: literals.colors.join('; ') }
        : { verdict: 'allowed', rule: '运行时数据或令牌变量' }))
    }
    if (INLINE_STYLE_SIZE_KEYS.test(body)) {
      findings.push(finding('inlineStyleSize', lineNo, snippet, literals.sizes.length
        ? { verdict: 'register', rule: '字面量尺寸：改类名或登记理由', value: literals.sizes.join('; ') }
        : { verdict: 'allowed', rule: '运行时计算（拖动、测量、定位、虚拟列表）' }))
    }
  }
  for (const match of text.matchAll(CLASS_LITERAL_PATTERN)) {
    const [, attribute, ...values] = match
    const classes = values.find((value) => value !== undefined) ?? ''
    const tag = enclosingTag(text, match.index)
    if (!tag) continue
    const checked = attribute === 'buttonClassName' ? ['Dropdown', 'PanelTrigger'].includes(tag.name) : /^Ui[A-Z]/.test(tag.name)
    if (!checked) continue
    const lineNo = lineNumberAt(text, match.index)
    // 豁免注释写在开始标签上方一行，或开始标签到 className 之间任意一行
    const tagLine = lineNumberAt(text, tag.index)
    if (lines.slice(Math.max(0, tagLine - 2), lineNo).some((line) => SURFACE_ALLOW_PATTERN.test(line))) continue
    const appearance = [...classes.replace(/\$\{[^}]*\}/g, ' ').matchAll(APPEARANCE_CLASS_PATTERN)].map((item) => item[0])
    if (appearance.length) findings.push(finding('appearanceOverride', lineNo, `<${tag.name}> ${appearance.join(' ')}`))
  }
  return findings
}

const REGISTRABLE_CATEGORIES = new Set(['arbitraryValue', 'inlineStyleSize', 'privateCssVar', 'privateCssLiteral'])
const MIN_REASON_LENGTH = 8

/**
 * 把登记文件套到命中上（scripts/ui-residue.allowlist.json）。
 * - entries：{ file, category, values[], reason }，按“文件 + 类别 + 值”放行 register 判定的命中；
 * - cssClasses：{ definedIn, names[], reason }，按类名放行私有 CSS 类（不管哪个文件在用）。
 * 登记必须写理由；登记的值已经不存在（过期）也算失败，登记只能跟着代码收。
 * @param {Map<string, object[]>} byFile 文件 → 命中（会就地写入 verdict = 'registered' 与 registeredReason）
 * @returns {{ errors: string[] }}
 */
function applyResidueAllowlist(byFile, allowlist) {
  const errors = []
  if (allowlist?.version !== 1 || !Array.isArray(allowlist.entries) || !Array.isArray(allowlist.cssClasses)) {
    return { errors: ['登记文件格式不正确（需要 version: 1、entries[]、cssClasses[]）'] }
  }
  const reasonOk = (reason) => typeof reason === 'string' && reason.replace(/\s/g, '').length >= MIN_REASON_LENGTH
  allowlist.entries.forEach((entry, index) => {
    const where = `entries[${index}] ${entry.file ?? '?'}`
    if (!REGISTRABLE_CATEGORIES.has(entry.category)) {
      errors.push(`${where}：类别 ${entry.category} 不可登记（可登记：${[...REGISTRABLE_CATEGORIES].join('、')}）`)
      return
    }
    if (!reasonOk(entry.reason)) errors.push(`${where}：理由少于 ${MIN_REASON_LENGTH} 字`)
    const findings = (byFile.get(entry.file) ?? []).filter((item) => item.category === entry.category)
    for (const value of entry.values ?? []) {
      const matched = findings.filter((item) => item.value === value)
      if (!matched.length) {
        errors.push(`${where}：登记的 ${entry.category} “${value}” 已不存在，删掉这条登记`)
        continue
      }
      for (const item of matched) {
        if (item.verdict === 'violation') {
          errors.push(`${where}：“${value}” 是违规（${item.rule}），不可登记`)
          continue
        }
        if (item.verdict === 'register') Object.assign(item, { verdict: 'registered', registeredReason: entry.reason })
      }
    }
  })
  allowlist.cssClasses.forEach((entry, index) => {
    const where = `cssClasses[${index}] ${entry.definedIn ?? '?'}`
    if (!reasonOk(entry.reason)) errors.push(`${where}：理由少于 ${MIN_REASON_LENGTH} 字`)
    for (const name of entry.names ?? []) {
      let matched = 0
      for (const findings of byFile.values()) {
        for (const item of findings) {
          if (item.category !== 'privateCssClass' || item.value !== name || item.definedIn !== entry.definedIn) continue
          matched += 1
          if (item.verdict === 'register') Object.assign(item, { verdict: 'registered', registeredReason: entry.reason })
        }
      }
      if (!matched) errors.push(`${where}：登记的类 .${name} 已没有使用方，删掉登记（类本身零引用时也要删）`)
    }
  })
  return { errors }
}

/** 用户可见文案：在字符串里，且不是日志、注释或助手能力别名。 */
function isLegacyCopyLine(line) {
  if (!LEGACY_COPY_TERMS.some((term) => line.includes(term))) return false
  if (isCommentLine(line)) return false
  if (/\b(logger|log|console)\.(debug|info|warn|error|log)\b|\baliases\b|\bkeywords\b/.test(line)) return false
  const withoutTrailingComment = line.replace(/\s\/\/.*$/, '')
  return LEGACY_COPY_TERMS.some((term) => new RegExp(`["'\`][^"'\`]*${term}[^"'\`]*["'\`]`).test(withoutTrailingComment))
}

/** 语言包 JSON：只看值。 */
function scanLocaleJson(text) {
  const findings = []
  text.split(/\r?\n/).forEach((line, index) => {
    const value = /:\s*"([^"]*)"/.exec(line)?.[1]
    if (value && LEGACY_COPY_TERMS.some((term) => value.includes(term))) {
      findings.push(finding('legacyCopy', index + 1, line.trim().slice(0, 160)))
    }
  })
  return findings
}

/** 主题令牌定义文件：变量是令牌本身，不算私有。 */
const TOKEN_DEFINITION_CSS = new Set(['src/index.css'])
const CSS_SIZE_LITERAL_PATTERN =
  /^\s*(?:width|height|min-width|max-width|min-height|max-height|font-size|line-height|padding[\w-]*|margin[\w-]*|border-radius|gap|top|left|right|bottom)\s*:\s*[^;]*\b\d+(?:\.\d+)?(?:px|rem)\b/

function scanCssText(text, relativePath) {
  const findings = []
  const tokenFile = TOKEN_DEFINITION_CSS.has(relativePath)
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1
    if (SURFACE_ALLOW_PATTERN.test(line)) {
      const reasoned = surfaceAllowHasReason(line)
      findings.push(finding('surfaceAllow', lineNo, line.trim().slice(0, 160), {
        verdict: reasoned ? 'allowed' : 'violation', rule: reasoned ? '行级豁免已写理由' : '行级豁免缺理由（≥ 8 字）',
      }))
    }
    if (isCommentLine(line)) return
    for (const match of line.matchAll(LEGACY_CSS_VAR_PATTERN)) findings.push(finding('legacyCssVar', lineNo, match[0]))
    if (tokenFile) return
    const variable = /^\s*(--[\w-]+)\s*:/.exec(line)
    if (variable) {
      const thirdParty = THIRD_PARTY_CSS_VARIABLE_PREFIXES.some((prefix) => variable[1].startsWith(prefix))
      findings.push(finding('privateCssVar', lineNo, line.trim().slice(0, 120), thirdParty
        ? { verdict: 'allowed', rule: '第三方库主题变量接到令牌' }
        : { verdict: 'register', rule: '私有变量：登记理由' }))
    }
    if (CSS_SIZE_LITERAL_PATTERN.test(line)) findings.push(finding('privateCssLiteral', lineNo, line.trim().slice(0, 120)))
  })
  return findings
}

/** 第三方库公开的主题变量（React Flow `--xy-*`）：在私有样式里把它们接到令牌上是合规用法。 */
const THIRD_PARTY_CSS_VARIABLE_PREFIXES = ['--xy-', '--dv-']

/**
 * css 里定义的类名（排除第三方前缀；共享组件类 ui-* 只在令牌文件 index.css 里算共享，
 * 写在其他样式表里的 ui-* 同样是私有类——5.4-10 的 `.ui-panel` / `.ui-field` 就是这样漏掉的）。
 */
const THIRD_PARTY_CLASS_PREFIXES = ['react-flow', 'dv-', 'ProseMirror', 'tiptap', 'xterm', 'monaco', 'cm-']
const SHARED_CLASS_PREFIX = 'ui-'
/** 复合选择器里的状态修饰类与 Tailwind 同名类：单独出现不代表用了私有样式。 */
const GENERIC_CLASS_NAMES = new Set(['active', 'disabled', 'selected', 'open', 'dark', 'light', 'fixed', 'absolute', 'relative',
  'hidden', 'block', 'flex', 'grid', 'group', 'peer', 'animate-pulse', 'animate-spin', 'animate-ping', 'animate-bounce'])
function extractCssClassNames(text, { includeShared = false } = {}) {
  const names = new Set()
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = block[1]
    if (/^\s*@/.test(selector)) continue
    for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (GENERIC_CLASS_NAMES.has(match[1]) || /^is-/.test(match[1])) continue
      if (THIRD_PARTY_CLASS_PREFIXES.some((prefix) => match[1].startsWith(prefix))) continue
      if (!includeShared && match[1].startsWith(SHARED_CLASS_PREFIX)) continue
      names.add(match[1])
    }
  }
  return [...names].sort()
}

function classReferencePattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 后面允许 `$`：模板里直接拼状态后缀（`canvas-node-paint-frame${active ? ' x' : ''}`）
  return new RegExp(`(^|[\\s"'\`{])${escaped}($|[\\s"'\`}$])`, 'm')
}

/**
 * 源码 import 说明符解析为仓库内文件（不含扩展名猜测，由调用方按候选列表命中）。
 * @returns {string[]} 说明符
 */
function extractImportSpecifiers(text) {
  const specifiers = new Set()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
    /\bvi\.mock\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) specifiers.add(match[1].replace(/\?.*$/, ''))
  return [...specifiers]
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.css', '/index.ts', '/index.tsx', '/index.js']
/** 说明符 → 仓库相对路径（命中 knownFiles 才返回），只解析相对路径与 `@/` 别名。 */
function resolveImport(specifier, fromRelative, knownFiles) {
  let base
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), specifier))
  else return null
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

/**
 * 5.1 盘点第四节的界面表：`##### 区域（5.x）` 下的 `| 编号 | 界面 | 主要文件 | …`。
 * @returns {{ id: string, name: string, region: string, regionLabel: string, paths: string[] }[]}
 */
function parseRegionInventory(markdown) {
  const entries = []
  let region = null
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{3,6}\s+(.+?)（(5\.\d)）\s*$/.exec(line)
    if (heading) {
      region = { label: heading[1], id: heading[2] }
      continue
    }
    if (!region) continue
    const row = /^\|\s*([A-Z]\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]*)\|/.exec(line)
    if (!row) continue
    const paths = [...row[3].matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
      .filter((value) => /\//.test(value) || /\.(tsx?|css)$/.test(value))
      .map((value) => `src/${value.replace(/^src\//, '')}`)
    entries.push({ id: row[1], name: row[2], region: region.id, regionLabel: region.label, paths })
  }
  return entries
}

/** 没有登记在 5.1 界面表里的文件按目录归区域。 */
const FALLBACK_REGION_RULES = Object.freeze([
  [/^src\/(workspaces\/GenerationWorkspace|components\/MediaGenerator|components\/params|components\/videoTrim|components\/PresetPanel)/, '5.3', '生成'],
  [/^src\/(features\/canvas|workspaces\/CanvasWorkspace)/, '5.4', '画布'],
  [/^src\/(features\/(audioEdit|imageMark|imageEdit|cameraStage|videoEdit|toolbox|maskEditor)|workspaces\/Toolbox)/, '5.5', '工具与剪辑'],
  [/^src\/(features\/(assets|assistant|settings|providers)|components\/settings)/, '5.6', '资产、设置与助手'],
  [/^src\/(components\/(ui|mediaViewer|upload)|features\/(onboarding|logs)|contexts)/, '5.7', '通用弹窗、菜单、查看器与独立窗口'],
])

/**
 * 文件 → 区域与界面编号。先按 5.1 表里最长的路径前缀命中，再按目录兜底。
 * @returns {{ region: string, regionLabel: string, surfaces: string[] }}
 */
function resolveRegion(relativePath, inventory) {
  let best = null
  for (const entry of inventory) {
    for (const entryPath of entry.paths) {
      const matched = entryPath.endsWith('/') ? relativePath.startsWith(entryPath) : relativePath === entryPath
      if (!matched) continue
      if (!best || entryPath.length > best.length) best = { length: entryPath.length, entries: [entry] }
      else if (entryPath.length === best.length) best.entries.push(entry)
    }
  }
  if (best) {
    return { region: best.entries[0].region, regionLabel: best.entries[0].regionLabel,
      surfaces: [...new Set(best.entries.map((entry) => entry.id))] }
  }
  for (const [pattern, region, regionLabel] of FALLBACK_REGION_RULES) {
    if (pattern.test(relativePath)) return { region, regionLabel, surfaces: [] }
  }
  return { region: '—', regionLabel: '未归属', surfaces: [] }
}

module.exports = {
  APPEARANCE_CLASS_PATTERN,
  ARBITRARY_VALUE_PATTERN,
  COLOR_UTILITY_PREFIX,
  LEGACY_ALIAS_COLOR_NAMES,
  LEGACY_ALIAS_PATTERN,
  RESIDUE_CATEGORIES,
  applyResidueAllowlist,
  classReferencePattern,
  classifyArbitraryValue,
  enclosingTagName,
  extractCssClassNames,
  finding,
  inlineStyleLiterals,
  surfaceAllowHasReason,
  extractImportSpecifiers,
  isLegacyCopyLine,
  parseRegionInventory,
  resolveImport,
  resolveRegion,
  scanCssText,
  scanLocaleJson,
  scanSourceText,
}
