/* eslint-disable @typescript-eslint/no-var-requires -- Node 门禁复用仓库 TypeScript 解析器。 */
const ts = require('typescript')

const MESSAGES = {
  S1: '分段请选择 UiSegmented（最多 5 个短选项，中性抬起选中）；更多或长选项用 Dropdown。',
  S2: '面板控件无标签：请放进 UiFormRow。',
  S3: '行内标签挤行：每个 Dropdown 请放进独立的 UiFormRow。',
  S4: '标题/元信息记录缺少边界：复用 UiRecordList / UiRecordItem。',
  S5: '同一面板组的表单行使用了不同标签列档位：请由面板统一指定 labelWidth。',
  S7: 'UiActionGroup 内按钮继承组的 tier/size，不得逐项覆盖 variant/size。',
  S8: '状态反馈复用 UiSpinner/UiSkeleton；按钮说明用 tooltip，不可用原因用 disabledReason。',
  S9: '同一表面最多一个主动作；次级动作使用 secondary 或 quiet。',
}
const CONTROLS = new Set(['Dropdown', 'NumberInput', 'UiRangeInput', 'UiSegmented', 'UiSelect'])

/** 只解析 JSX 结构，不执行用户代码；与现有规则 E 共用 TypeScript AST 方案。 */
function findUiSurfaceGrammar(raw, fileName = 'surface.tsx') {
  const source = ts.createSourceFile(fileName, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = raw.split(/\r?\n/)
  const findings = []
  const formWidths = []
  const comments = []
  // 普通 scanner 不会自行重扫模板插值尾部，先按 AST 隐去字面量，避免吞掉后面的 JSX 注释。
  // 同时防止字符串、正则或 JSX 文本里的标记被当作豁免；保留换行与字符偏移。
  const literalRanges = []
  function collectLiterals(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node)) {
      literalRanges.push([node.getStart(source), node.end])
    } else ts.forEachChild(node, collectLiterals)
  }
  collectLiterals(source)
  const commentChunks = []
  let commentCursor = 0
  for (const [start, end] of literalRanges.sort((a, b) => a[0] - b[0])) {
    commentChunks.push(raw.slice(commentCursor, start), raw.slice(start, end).replace(/[^\r\n]/g, ' '))
    commentCursor = end
  }
  const commentSource = [...commentChunks, raw.slice(commentCursor)].join('')
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, commentSource)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const startLine = source.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1
      scanner.getTokenText().split(/\r?\n/).forEach((text, index) => comments.push({ line: startLine + index, text }))
    }
  }
  const aliases = new Map()
  const constants = new Map()
  function collect(node) {
    if (ts.isImportSpecifier(node)) aliases.set(node.name.text, (node.propertyName || node.name).text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(source)
  const opening = node => !node ? undefined : ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined
  const name = node => { const text = opening(node)?.tagName.getText(source); return aliases.get(text) || text }
  const attribute = (node, key) => opening(node)?.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === key)
  function strings(node, seen = new Set()) {
    if (!node) return ''
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) return strings(constants.get(node.text), new Set([...seen, node.text]))
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.flatMap(span => [strings(span.expression, seen), span.literal.text])].join(' ')
    return node.getChildren(source).map(child => strings(child, seen)).join(' ')
  }
  const attrText = (node, key) => strings(attribute(node, key)?.initializer).trim()
  const classes = node => attrText(node, 'className').split(/\s+/)
  function report(rule, node, severity = 'error') {
    const lineNo = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    // Only actual comments on this/previous line; require exact rule id and a nonempty reason.
    const comment = new RegExp(`ui-surface-allow:\\s*${rule}\\s+([^*}\\s][^*}]*)`)
    if (comments.some(item => (item.line === lineNo || item.line === lineNo - 1) && comment.test(item.text))) return
    if (!findings.some(item => item.rule === rule && item.lineNo === lineNo)) findings.push({ rule, lineNo, severity, message: MESSAGES[rule], snippet: lines[lineNo - 1].trim() })
  }
  const isMap = node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map'
  // Fragment、条件表达式与 map 都不产生 DOM 父级；普通 JSX 元素保留边界。
  function roots(node) {
    if (!node) return []
    if (opening(node)) return [node]
    if (ts.isJsxText(node)) return node.text.trim() ? [node] : []
    if (ts.isJsxExpression(node)) return roots(node.expression)
    if (ts.isJsxFragment(node)) return node.children.flatMap(roots)
    if (ts.isParenthesizedExpression(node)) return roots(node.expression)
    if (ts.isConditionalExpression(node)) return [...roots(node.whenTrue), undefined, ...roots(node.whenFalse)]
    if (ts.isBinaryExpression(node)) return roots(node.right)
    if (isMap(node)) return node.arguments.flatMap(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg) ? roots(arg.body) : [])
    if (ts.isBlock(node)) return node.statements.flatMap(statement => ts.isReturnStatement(statement) ? roots(statement.expression) : [])
    return []
  }
  const segment = node => name(node) === 'UiOptionButton' && attrText(node, 'variant') === 'segment'
  function toolbar(node) {
    for (let parent = node; parent; parent = parent.parent) {
      if (name(parent) === 'UiToolbar') return true
      if (opening(parent)?.tagName.getText(source) === 'UiFieldLayoutContext.Provider') return attrText(parent, 'value') === 'toolbar'
    }
    return false
  }
  function literalWidth(node) {
    const initializer = attribute(node, 'labelWidth')?.initializer
    if (!initializer) return undefined
    let value = ts.isJsxExpression(initializer) ? initializer.expression : initializer
    if (value && ts.isIdentifier(value)) value = constants.get(value.text)
    return value && ts.isNumericLiteral(value) && [72, 96, 120].includes(Number(value.text)) ? Number(value.text) : null
  }
  function formWidth(node) {
    // auto 仅用于工具条和成对网格；动态列档位不猜测，交给运行时验收。
    if (attrText(node, 'labelColumn') === 'auto') return undefined
    const own = literalWidth(node)
    if (own !== undefined) return own
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (name(parent) === 'UiGroup') {
        const inherited = literalWidth(parent)
        if (inherited !== undefined) return inherited
      }
    }
    if (opening(node).attributes.properties.some(ts.isJsxSpreadAttribute)) return undefined
    return attrText(node, 'labelColumn') === 'panel' ? 72 : undefined
  }
  const surface = node => name(node) === 'UiModal' || (name(node) === 'UiToolbar' && attrText(node, 'variant') === 'command') || Boolean(attribute(node, 'data-application-surface-id'))
  function primaryCount(node, root) {
    if (!node || (node !== root && surface(node))) return 0
    if (ts.isConditionalExpression(node)) return Math.max(primaryCount(node.whenTrue, root), primaryCount(node.whenFalse, root))
    if ((name(node) === 'UiButton' && attrText(node, 'variant') === 'primary') || (name(node) === 'UiIconButton' && attrText(node, 'tone') === 'accent')) return 1
    let count = 0
    ts.forEachChild(node, child => { count += primaryCount(child, root) })
    return count
  }
  function visit(node) {
    if (surface(node) && primaryCount(node, node) > 1) report('S9', node)
    if (name(node) === 'UiButton') {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (name(parent) !== 'UiActionGroup') continue
        if (attribute(node, 'variant') || attribute(node, 'size')) report('S7', node)
        break
      }
    }
    if (/^Ui.*Button$/.test(name(node) || '')) {
      if (attribute(node, 'title')) report('S8', node)
      const disabled = attribute(node, 'disabled')
      const expression = disabled?.initializer && ts.isJsxExpression(disabled.initializer) ? disabled.initializer.expression?.getText(source) : ''
      const pureBusy = /^(?:[\w$]+\.)*(?:is)?(?:busy|loading|pending|saving)$/i.test(expression || '')
      if (disabled && !pureBusy && !attribute(node, 'disabledReason')) report('S8', node, 'warning')
    }
    if (['p', 'div', 'span'].includes(name(node)) && attrText(node, 'role') === 'alert' && classes(node).includes('text-danger-text') && !/\/components\/ui\//.test(fileName.replace(/\\/g, '/'))) report('S8', node, 'warning')
    if (!/\/components\/ui\/(?:UiSpinner|states)\.tsx$/.test(fileName.replace(/\\/g, '/')) && classes(node).some(token => /(?:^|:)animate-(?:spin|pulse)$/.test(token))) report('S8', node)
    if (name(node) === 'UiSegmented' || name(node) === 'SettingsSegmented') {
      const options = attribute(node, 'options')?.initializer
      const expression = options && ts.isJsxExpression(options) ? options.expression : undefined
      const array = expression && ts.isIdentifier(expression) ? constants.get(expression.text) : expression
      if (array && ts.isArrayLiteralExpression(array) && !array.elements.some(ts.isSpreadElement) && array.elements.length > 5) report('S1', node)
    }
    if (name(node) === 'UiFormRow' && !toolbar(node)) {
      const width = formWidth(node)
      let scope = source
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (name(parent) === 'UiGroup' && attribute(parent, 'labelWidth')) { scope = parent; break }
      }
      if (typeof width === 'number') formWidths.push({ node, width, scope })
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children.flatMap(roots)
      if (children.some((child, index) => segment(child) && segment(children[index + 1]))) report('S1', node)
      if (name(node) === 'UiGroup' && !toolbar(node)) for (const child of children) if (CONTROLS.has(name(child))) report('S2', child)
      const tokens = classes(node)
      if ((tokens.includes('flex') || tokens.includes('inline-flex')) && !tokens.includes('flex-col') && children.filter(child => name(child) === 'Dropdown' && attribute(child, 'label')).length >= 2) report('S3', node)
    }
    if (isMap(node)) {
      for (const root of roots(node)) {
        if (segment(root)) report('S1', root)
        if (!opening(root) || name(root) === 'UiRecordItem' || (name(root) === 'UiOptionButton' && ['grid', 'menu', 'cover'].includes(attrText(root, 'variant')))) continue
        const tokens = classes(root)
        const container = node.parent?.parent
        const titles = [], metadata = []
        let divider = [...tokens, ...classes(container)].some(token => /(?:^|:)(?:border-[tb](?:$|-[1-8]$)|divide-y(?:$|-)|UI_DIVIDER_CLASS)/.test(token))
          || /\bUI_DIVIDER_CLASS\b/.test(attribute(root, 'className')?.getText(source) || '')
          || /\bUI_DIVIDER_CLASS\b/.test(attribute(container, 'className')?.getText(source) || '')
        const textLayers = child => {
          if (opening(child)) {
            const cls = classes(child).join(' ')
            if (/(?:font-medium|font-semibold|text-sm|text-14)/.test(cls) || /^h[1-6]$/.test(name(child) || '')) titles.push(child)
            if (/(?:text-text[23]|text-xs|text-2xs)/.test(cls)) metadata.push(child)
            divider ||= name(child) === 'UiRecordItem'
          }
          ts.forEachChild(child, textLayers)
        }
        textLayers(root)
        if (titles.some(title => metadata.some(meta => title !== meta)) && !divider) report('S4', root)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const widthsByGroup = new Map()
  for (const entry of formWidths) {
    if (!widthsByGroup.has(entry.scope)) widthsByGroup.set(entry.scope, entry.width)
    else if (entry.width !== widthsByGroup.get(entry.scope)) report('S5', entry.node)
  }
  return findings
}

module.exports = { findUiSurfaceGrammar }
