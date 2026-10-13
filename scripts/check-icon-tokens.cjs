#!/usr/bin/env node
/**
 * 图标令牌检查。
 *
 * 背景：图标此前没有单点落地，业务组件一半用 lucide、一半手写 inline <svg>，
 * 结果同一个「资产库」概念在顶部导航、工具栏、侧栏长成三个样，
 * 「工具箱」和「设置」还共用了同一个齿轮。
 *
 * 规则：
 *   D. lucide 尺寸与描边登记，禁止按钮子图标覆盖；S6. 静态同行控件同档。
 *   A. 业务组件禁止手写 <svg>——图标一律走 lucide-react（与「原生 <button> 只能落在
 *      primitives.tsx」同构）。真正的图形（波形、缓动曲线、连线预览）在豁免名单里。
 *   B. 跨界面复用的业务概念图标必须走 `src/core/theme/icons.ts` 的登记常量，
 *      不要在调用点各自从 lucide 挑图形。
 *   C. 界面可见文字（src、electron 的 ts/tsx 与 i18n 文案）禁止用 emoji 及 ✓ ✗ ▶ 等符号字符
 *      充当图标或状态标记；emoji 只允许进开发者控制台。注释与 console.* 输出豁免，判定见
 *      scripts/lib/symbolGlyphs.cjs（自测 symbolGlyphs.test.cjs）。
 *
 * 用法：
 *   node scripts/check-icon-tokens.cjs            # 告警式，退出码恒为 0
 *   node scripts/check-icon-tokens.cjs --strict   # 门禁式，有命中即非 0
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { findSymbolGlyphs } = require('./lib/symbolGlyphs.cjs')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const REGISTRY = path.join(SRC, 'core', 'theme', 'icons.ts')
const ELECTRON = path.join(ROOT, 'electron')
const LOCALES = path.join(SRC, 'i18n', 'locales')

/**
 * 规则 C 的文件级豁免：整份文件只产出开发者控制台内容。新增豁免必须写明理由。
 */
const GLYPH_FILE_EXEMPTIONS = new Map([
  ['src/core/logging/logger.ts', '控制台格式化（CONSOLE_EVENT_LABELS / buildConsoleDetail / 级别标签只进 console，不写入日志文件与日志窗口）'],
])

/**
 * 真正的图形，不是图标：这些 <svg> 承载的是数据可视化或画布绘制，
 * 换成图标库反而是错的。新增豁免必须在这里写明理由。
 */
const GRAPHIC_EXEMPTIONS = new Map([
  ['src/features/videoEdit/panels/VideoEditKeyframeControls.tsx', '片段内时间驱动的迷你关键帧轨与播放头，坐标来自关键帧数据'],
  ['src/features/videoEdit/timeline/VideoEditTimelineKeyframes.tsx', '片段音量与不透明度曲线、控制点及时间标记，路径由数据计算'],
  ['src/components/ui/UiColorGrading.tsx', '调色曲线数据图形与控制点，坐标来自用户曲线参数，不是图标'],
  ['src/features/cameraStage/timeline/EasingCurveEditor.tsx', '缓动曲线编辑器，路径由控制点算出'],
  ['src/features/cameraStage/timeline/GraphEditor.tsx', '关键帧曲线图，路径由数据算出'],
  ['src/features/canvas/ui/CanvasOverlays.tsx', '画布连线预览，路径随指针位置实时计算'],
  ['src/features/videoEdit/panels/VideoEditMaskOverlay.tsx', '剪辑遮罩路径与控制柄，路径由遮罩顶点按片段几何算出'],
])

/**
 * 只登记在本仓库里**语义唯一**的图形。
 *
 * 刻意不登记 LayoutGrid / Wrench / MessageCircle 这类通用形状：它们在本仓库同时表示
 * 多个含义（LayoutGrid 既是画布 tab、又是分组节点、还是设置里的「界面」分区；
 * Wrench 既是工具箱、又是助手的工具调用）。把它们锁死只会逼出一堆错误重命名。
 * 「同一形状表示多个概念」是另一类问题，要靠换形状解决，不归这条检查管。
 */
const CONCEPT_ICONS = new Map([
  ['Library', 'ICON_ASSET_LIBRARY'],
  ['LibraryBig', 'ICON_ASSET_LIBRARY'],
  ['Clapperboard', 'ICON_TOOL_CAMERA_STAGE'],
])

const ALLOW_COMMENT = 'icon-token-allow'

function walk(dir, out = [], pattern = /\.tsx$/) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out, pattern)
    } else if (pattern.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 规则 C 扫描范围：界面代码与主进程（不含测试），以及 i18n 文案。 */
function collectGlyphTargets() {
  const code = [
    ...walk(SRC, [], /\.(ts|tsx)$/),
    ...walk(ELECTRON, [], /\.(ts|tsx)$/),
  ].filter((file) => !/\.(test|spec)\.tsx?$/.test(file) && !/\.d\.ts$/.test(file))
  return [
    ...code.map((file) => ({ file, json: false })),
    ...walk(LOCALES, [], /\.json$/).map((file) => ({ file, json: true })),
  ]
}

function toRel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function lineAllowed(lines, index) {
  const current = lines[index] || ''
  const previous = lines[index - 1] || ''
  return current.includes(ALLOW_COMMENT) || previous.includes(ALLOW_COMMENT)
}

// 从正式登记表读取档位，门禁不维护第二套尺寸值。
const ICON_SIZE_VALUES = new Set([...fs.readFileSync(REGISTRY, 'utf8')
  .match(/export const UI_ICON_SIZE = \{([^}]+)\}/)[1].matchAll(/:\s*(\d+)/g)].map(match => Number(match[1])))

function findIconSizingViolations(source, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const icons = new Set()
  const buttons = new Set(['UiButton', 'UiIconButton'])
  let hasIcons = false
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    const imported = statement.importClause?.namedBindings
    if (imported && ts.isNamedImports(imported)) for (const entry of imported.elements) {
      if (/^(UiButton|UiIconButton)$/.test(entry.propertyName?.text ?? entry.name.text)) buttons.add(entry.name.text)
    }
    if (module !== 'lucide-react' && !/theme\/icons$/.test(module)) continue
    hasIcons = true
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const entry of bindings.elements) {
      if (!entry.isTypeOnly && !(entry.propertyName?.text ?? entry.name.text).startsWith('UI_')) icons.add(entry.name.text)
    }
  }
  const findings = []
  const variables = new Map()
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(ast)
  function literals(node, seen = new Set()) {
    if (!node) return []
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return [node.text]
    if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return literals(variables.get(node.text), new Set([...seen, node.text]))
    const result = []
    ts.forEachChild(node, child => { result.push(...literals(child, seen)) })
    return result
  }
  function numericValues(node, seen = new Set()) {
    if (!node) return []
    if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return numericValues(variables.get(node.text), new Set([...seen, node.text]))
    if (ts.isNumericLiteral(node)) return [Number(node.text)]
    if (ts.isConditionalExpression(node)) return [...numericValues(node.whenTrue, seen), ...numericValues(node.whenFalse, seen)]
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return numericValues(node.expression, seen)
    if (ts.isStringLiteral(node) && /^\d+(\.\d+)?$/.test(node.text)) return [Number(node.text)]
    return []
  }
  function visit(node, inButton = false) {
    if (ts.isJsxElement(node)) {
      visit(node.openingElement, inButton)
      const nested = inButton || buttons.has(node.openingElement.tagName.getText(ast))
      node.children.forEach(child => visit(child, nested))
      return
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast)
      if (icons.has(tag) || hasIcons && /(?:^Icon$|Icon$)/.test(tag)) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue
          const name = attr.name.text
          const text = attr.initializer?.getText(ast) ?? ''
          const sizes = literals(attr.initializer).flatMap(value => [...value.matchAll(/(?:^|[\s:!])(?:h|w|size)-(\d+(?:\.\d+)?|\[[^\]]+\])/g)].map(match => match[1]))
          let message
          if (inButton && (name === 'size' || name === 'className' && (sizes.length || /\bUI_ICON_SIZE_CLASS\b/.test(text)))) message = '按钮子图标不得覆盖尺寸；由控件 size 自动提供'
          else if (name === 'size' && numericValues(attr.initializer).some(value => !ICON_SIZE_VALUES.has(value))) message = '图标尺寸必须来自 UI_ICON_SIZE 登记档位'
          else if (name === 'className' && sizes.some(value => !ICON_SIZE_VALUES.has(Number(value) * 4))) message = '图标尺寸类必须来自 UI_ICON_SIZE_CLASS 登记档位'
          else if (name === 'strokeWidth' && !/^\{(?:UI_ICON_STROKE_WIDTH|UI_WINDOW_ICON_STROKE_WIDTH)\}$/.test(text)) message = '图标描边沿用 lucide 默认值；仅允许登记的窗口控件例外'
          if (message) findings.push({ rule: 'D', line: ast.getLineAndCharacterOfPosition(attr.getStart(ast)).line + 1, message })
        }
      }
    }
    ts.forEachChild(node, child => visit(child, inButton))
  }
  visit(ast)
  return findings
}

/** S6 的静态子集：只比较已知共享控件的直接兄弟，不猜条件分支、包装器和弹性布局。 */
function findControlRowViolations(source, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings = []
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(ast)
      const cls = node.openingElement.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.text === 'className')?.initializer
      const classes = cls && ts.isStringLiteral(cls) ? cls.text : ''
      if (tag === 'UiToolbar' || /\bflex\b/.test(classes) && !/flex-col|flex-wrap/.test(classes)) {
        const peers = node.children.flatMap(child => {
          const opening = ts.isJsxElement(child) ? child.openingElement : ts.isJsxSelfClosingElement(child) ? child : null
          if (!opening) return []
          const name = opening.tagName.getText(ast)
          if (!/^(UiButton|UiIconButton|UiInput|UiSelect|UiSegmented|UiReadout|UiFieldTrigger|NumberInput|Dropdown|UiChipButton)$/.test(name)) return []
          // 展开 props 可能改变 size，交给实际 DOM 检查。
          if (opening.attributes.properties.some(ts.isJsxSpreadAttribute)) return []
          const attr = key => opening.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === key)?.initializer
          const variant = attr('variant')
          if (variant && ts.isStringLiteral(variant) && variant.text === 'link') return []
          const size = attr('size')
          const resolved = size ? ts.isStringLiteral(size) ? size.text : null : 'md'
          return resolved ? [{ name, size: resolved }] : []
        })
        if (new Set(peers.map(peer => peer.size)).size > 1) findings.push({
          rule: 'S6', line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          message: `同行控件尺寸不一致：${peers.map(peer => `${peer.name}=${peer.size}`).join('、')}`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}

function main() {
  const strict = process.argv.includes('--strict')
  const findings = []

  for (const file of walk(SRC)) {
    const rel = toRel(file)
    if (rel === 'src/core/theme/icons.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/)
    if (!/\.(test|spec)\.tsx?$/.test(rel)) {
      findings.push(...findIconSizingViolations(source, file).map(hit => ({ ...hit, rel })))
      findings.push(...findControlRowViolations(source, file).map(hit => ({ ...hit, rel })))
    }

    // 规则 A：手写 <svg>
    if (!GRAPHIC_EXEMPTIONS.has(rel)) {
      lines.forEach((line, index) => {
        if (!line.includes('<svg')) return
        if (lineAllowed(lines, index)) return
        findings.push({
          rule: 'A',
          rel,
          line: index + 1,
          message: '手写 inline <svg>：图标请改用 lucide-react；确属图形请加入豁免名单并写明理由',
        })
      })
    }

    // 规则 B：概念图标绕过登记表
    const importMatch = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/)
    if (importMatch) {
      const imported = importMatch[1]
        .split(',')
        .map((name) => name.replace(/\btype\b/, '').trim())
        .filter(Boolean)
      const importLine = source.slice(0, importMatch.index).split(/\r?\n/).length
      for (const name of imported) {
        const token = CONCEPT_ICONS.get(name)
        if (!token) continue
        if (lineAllowed(lines, importLine - 1)) continue
        findings.push({
          rule: 'B',
          rel,
          line: importLine,
          message: `概念图标 ${name} 应改用登记常量 ${token}（@/core/theme/icons）`,
        })
      }
    }
  }

  // 规则 C：emoji / 符号字符当图标
  for (const { file, json } of collectGlyphTargets()) {
    const rel = toRel(file)
    if (GLYPH_FILE_EXEMPTIONS.has(rel)) continue
    for (const hit of findSymbolGlyphs(fs.readFileSync(file, 'utf8'), { json })) {
      findings.push({
        rule: 'C',
        rel,
        line: hit.line,
        message: `界面文字里的符号「${hit.glyph}」当作图标或状态标记：改用 lucide 图标或文字（控制台输出与注释豁免）`,
      })
    }
  }

  if (findings.length === 0) {
    console.log('[check-icon-tokens] 通过：图标规则 A–D 与同行尺寸静态规则 S6 无违规。')
    return
  }

  for (const item of findings) {
    console.log(`[${item.rule}] ${item.rel}:${item.line} ${item.message}`)
  }
  console.log(`\n[check-icon-tokens] 命中 ${findings.length} 处。`)
  console.log(`仅 A–C 支持豁免；D/S6 不支持注释绕过。在该行或上一行加注释 ${ALLOW_COMMENT} 并说明理由。`)
  if (strict) process.exitCode = 1
}

module.exports = { findIconSizingViolations, findControlRowViolations }

if (require.main === module && !fs.existsSync(REGISTRY)) {
  console.error('[check-icon-tokens] 缺少图标登记表 src/core/theme/icons.ts')
  process.exitCode = 1
} else if (require.main === module) {
  main()
}
