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

const RESIDUE_CATEGORIES = Object.freeze([
  { key: 'legacyAlias', label: '旧 Tailwind 别名类', gate: 'check:colors（legacy，4.2 B 段迁移后清零）' },
  { key: 'legacyCssVar', label: '旧 CSS 变量', gate: 'check:colors（已是硬性规则）' },
  { key: 'arbitraryValue', label: '任意值类', gate: '5.8 新增' },
  { key: 'arbitraryPx', label: '任意值类（写死 px）', gate: '5.8 新增' },
  { key: 'inlineStyleColor', label: '内联 style 含颜色', gate: '逐条判定（端口类型色等动态值可留）' },
  { key: 'inlineStyleSize', label: '内联 style 含尺寸', gate: '逐条判定（拖动尺寸、定位可留）' },
  { key: 'appearanceOverride', label: '调用点覆盖组件外观', gate: 'check:surface 规则 E 之外的 Ui* 组件' },
  { key: 'surfaceAllow', label: 'ui-surface-allow 行级豁免', gate: '逐条复核理由' },
  { key: 'colorAllowlist', label: 'check:colors 登记项', gate: 'check:colors 登记文件' },
  { key: 'privateCssVar', label: '组件私有 CSS 变量', gate: '5.8 新增' },
  { key: 'privateCssLiteral', label: '组件私有 CSS 写死尺寸', gate: '5.8 新增' },
  { key: 'privateCssClass', label: '使用私有 CSS 类', gate: '逐条判定（画布 LOD/性能机制类可留）' },
  { key: 'unusedCssClass', label: '零引用 CSS 类（候选）', gate: '人工确认无动态拼接后删除' },
  { key: 'deadCode', label: '零引用源文件（候选）', gate: '人工确认无动态引用后删除' },
  { key: 'testOnlyCode', label: '仅测试引用的源文件（候选）', gate: '人工确认' },
  { key: 'legacyCopy', label: '旧文案', gate: '5.8 新增' },
])

function isCommentLine(line) {
  return /^\s*(\/\/|\/\*|\*)/.test(line)
}

function lineNumberAt(text, index) {
  let line = 1
  for (let cursor = text.indexOf('\n'); cursor !== -1 && cursor < index; cursor = text.indexOf('\n', cursor + 1)) line += 1
  return line
}

/** 最近的未闭合 JSX 开始标签名（只看 className 之前的文本，够报告用）。 */
function enclosingTagName(text, index) {
  const before = text.slice(Math.max(0, index - 1200), index)
  let match
  let last = null
  OPENING_TAG_PATTERN.lastIndex = 0
  while ((match = OPENING_TAG_PATTERN.exec(before))) last = { name: match[1], index: match.index }
  if (!last) return null
  // 中间已经出现了标签结束（`>` 后跟换行/标签），说明 className 不属于这个标签
  const between = before.slice(last.index)
  if (/(^|[^=])>\s*(\n|<|\{)/.test(between.replace(/=>/g, '=='))) return null
  return last.name
}

/**
 * 扫描一个 ts/tsx 源文件的文本。
 * @returns {{ category: string, line: number, text: string }[]}
 */
function scanSourceText(text) {
  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const lineNo = index + 1
    if (SURFACE_ALLOW_PATTERN.test(line)) findings.push({ category: 'surfaceAllow', line: lineNo, text: line.trim().slice(0, 160) })
    if (isCommentLine(line)) return
    for (const match of line.matchAll(LEGACY_ALIAS_PATTERN)) findings.push({ category: 'legacyAlias', line: lineNo, text: match[0] })
    for (const match of line.matchAll(LEGACY_CSS_VAR_PATTERN)) findings.push({ category: 'legacyCssVar', line: lineNo, text: match[0] })
    for (const match of line.matchAll(ARBITRARY_VALUE_PATTERN)) {
      findings.push({ category: 'arbitraryValue', line: lineNo, text: match[0] })
      if (PX_VALUE_PATTERN.test(match[0])) findings.push({ category: 'arbitraryPx', line: lineNo, text: match[0] })
    }
    if (isLegacyCopyLine(line)) {
      for (const term of LEGACY_COPY_TERMS) {
        if (line.includes(term)) findings.push({ category: 'legacyCopy', line: lineNo, text: line.trim().slice(0, 160) })
      }
    }
  })
  for (const match of text.matchAll(INLINE_STYLE_PATTERN)) {
    const body = match[1]
    const lineNo = lineNumberAt(text, match.index)
    if (isCommentLine(lines[lineNo - 1] ?? '')) continue
    const snippet = match[0].replace(/\s+/g, ' ').slice(0, 160)
    if (INLINE_STYLE_COLOR_KEYS.test(body)) findings.push({ category: 'inlineStyleColor', line: lineNo, text: snippet })
    if (INLINE_STYLE_SIZE_KEYS.test(body)) findings.push({ category: 'inlineStyleSize', line: lineNo, text: snippet })
  }
  for (const match of text.matchAll(CLASS_LITERAL_PATTERN)) {
    const [, attribute, ...values] = match
    const classes = values.find((value) => value !== undefined) ?? ''
    const tag = enclosingTagName(text, match.index)
    if (!tag) continue
    const checked = attribute === 'buttonClassName' ? ['Dropdown', 'PanelTrigger'].includes(tag) : /^Ui[A-Z]/.test(tag)
    if (!checked) continue
    const lineNo = lineNumberAt(text, match.index)
    if (SURFACE_ALLOW_PATTERN.test(lines[lineNo - 1] ?? '') || SURFACE_ALLOW_PATTERN.test(lines[lineNo - 2] ?? '')) continue
    const appearance = [...classes.replace(/\$\{[^}]*\}/g, ' ').matchAll(APPEARANCE_CLASS_PATTERN)].map((item) => item[0])
    if (appearance.length) findings.push({ category: 'appearanceOverride', line: lineNo, text: `<${tag}> ${appearance.join(' ')}` })
  }
  return findings
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
      findings.push({ category: 'legacyCopy', line: index + 1, text: line.trim().slice(0, 160) })
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
    if (SURFACE_ALLOW_PATTERN.test(line)) findings.push({ category: 'surfaceAllow', line: lineNo, text: line.trim().slice(0, 160) })
    if (isCommentLine(line)) return
    for (const match of line.matchAll(LEGACY_CSS_VAR_PATTERN)) findings.push({ category: 'legacyCssVar', line: lineNo, text: match[0] })
    if (tokenFile) return
    if (/^\s*--[\w-]+\s*:/.test(line)) findings.push({ category: 'privateCssVar', line: lineNo, text: line.trim().slice(0, 120) })
    if (CSS_SIZE_LITERAL_PATTERN.test(line)) findings.push({ category: 'privateCssLiteral', line: lineNo, text: line.trim().slice(0, 120) })
  })
  return findings
}

/** css 里定义的类名（排除共享组件 ui-*、第三方前缀）。 */
const THIRD_PARTY_CLASS_PREFIXES = ['ui-', 'react-flow', 'dv-', 'ProseMirror', 'tiptap', 'xterm', 'monaco', 'cm-']
/** 复合选择器里的状态修饰类与 Tailwind 同名类：单独出现不代表用了私有样式。 */
const GENERIC_CLASS_NAMES = new Set(['active', 'disabled', 'selected', 'open', 'dark', 'light', 'fixed', 'absolute', 'relative',
  'hidden', 'block', 'flex', 'grid', 'group', 'peer', 'animate-pulse', 'animate-spin', 'animate-ping', 'animate-bounce'])
function extractCssClassNames(text) {
  const names = new Set()
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = block[1]
    if (/^\s*@/.test(selector)) continue
    for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      if (GENERIC_CLASS_NAMES.has(match[1]) || /^is-/.test(match[1])) continue
      if (!THIRD_PARTY_CLASS_PREFIXES.some((prefix) => match[1].startsWith(prefix))) names.add(match[1])
    }
  }
  return [...names].sort()
}

function classReferencePattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s"'\`{])${escaped}($|[\\s"'\`}])`, 'm')
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
  classReferencePattern,
  enclosingTagName,
  extractCssClassNames,
  extractImportSpecifiers,
  isLegacyCopyLine,
  parseRegionInventory,
  resolveImport,
  resolveRegion,
  scanCssText,
  scanLocaleJson,
  scanSourceText,
}
