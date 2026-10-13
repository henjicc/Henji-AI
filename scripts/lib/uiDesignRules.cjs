const ts = require('typescript')
const postcss = require('postcss')

const SPACING = new Set([0, 2, 4, 6, 8, 12, 16, 20, 24, 32])
// 4.3 移交的几何值逐项登记；不是扩充间距刻度，不接受目录级豁免。
const SPACING_EXCEPTIONS = {
  'src/components/ProjectCardGrid.tsx': { 'pl-11': '列表缩略图占位，避免文字覆盖封面' },
  'src/components/Settings/components/ApiKeyInput.tsx': { 'pr-12': '右侧密钥显隐按钮占位，避免输入文字重叠' },
  'src/components/Settings/index.tsx': { 'pl-11': '设置目录图标槽的对齐占位' },
  'src/components/TabContainer.tsx': { 'pt-10': '应用标题栏四十像素覆盖区的布局预留' },
  'src/components/ui/primitives.tsx': { 'pl-7': '字段前导图标占位', 'pr-7': '字段尾部图标占位', 'px-[0.1em]': '逐字稿行内词块的相对字宽命中区' },
  'src/components/ui/states.tsx': { 'py-16': '空态在空工作面中的垂直留白' },
  'src/components/ui/styleTokens.ts': { 'mt-[-3px]': '滑块拇指相对轨道居中的光学校正' },
  'src/features/assets/components/AssetLibrarySidebar.tsx': { 'pr-16': '列表尾部操作按钮预留两按钮宽度' },
  'src/features/canvas/nodes/assetGroup/AssetGroupPreview.tsx': { 'gap-px': '联系表缩略图的一像素图像分界' },
  'src/features/canvas/nodes/video/CanvasVideoPlayer.tsx': { 'pt-9': '媒体顶栏三十六像素覆盖区预留' },
  'src/features/canvas/ui/specialInterfaces/panorama/PanoramaViewerModal.tsx': { 'pt-12': '查看器顶栏覆盖区预留' },
  'src/features/devGallery/UiGalleryPage.tsx': { 'pt-10': '开发样张同样避让应用标题栏覆盖区' },
  'src/features/devGallery/gallerySections.tsx': { 'pt-12': '静态弹窗样张为标题与边界预留空间' },
  'src/features/videoEdit/timeline/VideoEditTrackHeader.tsx': { 'gap-px': '轨道密集操作的相邻命中区边界' },
}
const LAYOUT_EXCEPTIONS = {
  'src/components/ui/fileUploader/StackedMediaUploader.tsx': ['width'],
  'src/workspaces/GenerationWorkspace/components/TaskInputPreview.tsx': ['width', 'margin', 'margin-left'],
  'src/components/TabContainer.tsx': ['padding'],
  'src/components/ui/layout.tsx': ['grid-template-rows'],
  'src/workspaces/GenerationWorkspace/components/FloatingInputPanel.tsx': ['max-height'],
}
const LAYOUT = /^(?:all|width|height|min-width|max-width|min-height|max-height|padding(?:-.+)?|margin(?:-.+)?|top|left|right|bottom|grid-template(?:-.+)?)$/

function findDesignRules(raw, fileName) {
  const file = fileName.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')
  const findings = []
  const add = (rule, value, pos) => {
    const lineNo = raw.slice(0, pos).split('\n').length
    if (!findings.some(x => x.rule === rule && x.lineNo === lineNo && x.value === value)) findings.push({ rule, value, lineNo, severity: 'error', message: `${rule}: ${value}` })
  }
  const spacing = (value, pos, token = value) => {
    if (SPACING_EXCEPTIONS[file]?.[token]) return
    for (const part of String(value).split(/\s+/)) {
      const match = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(part)
      if (match && !SPACING.has(Math.abs(Number(match[1]) * (match[2] === 'rem' ? 16 : 1)))) add('spacingScale', token, pos)
    }
  }
  const layout = (value, pos) => {
    for (const prop of value.split(/[,\s]+/)) if (LAYOUT.test(prop) && !LAYOUT_EXCEPTIONS[file]?.includes(prop)) add('layoutTransition', prop, pos)
  }
  const motion = (value, pos) => {
    const withoutVars = value.replace(/var\(--(?:ui-(?:duration|loop|ease)[\w-]*|assistant-layout-transition-duration)[^)]*\)/g, '')
    for (const match of withoutVars.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) {
      if (Number(match[1]) !== 0) add('motionScale', match[0], pos)
    }
    if (/\bease(?:-in|-out|-in-out)?\b|cubic-bezier\(/.test(withoutVars)) add('motionEase', value, pos)
  }
  if (file.endsWith('.css')) {
    const root = postcss.parse(raw, { from: file })
    root.walkDecls(decl => {
      const pos = decl.source.start.offset
      if (/^(?:padding|margin)(?:-.+)?$|^(?:row-|column-)?gap$/.test(decl.prop)) spacing(decl.value, pos)
      if (/^(?:transition|animation)(?:-.+)?$/.test(decl.prop)) {
        // 全局 reduced-motion 的近零时长保留结束事件；不能扩散到业务样式。
        const reduced = file === 'src/index.css' && decl.parent.parent?.type === 'atrule' && /prefers-reduced-motion:\s*reduce/.test(decl.parent.parent.params)
        if (!reduced) motion(decl.value, pos)
        if (/^transition(?:-property)?$/.test(decl.prop)) layout(decl.value.replace(/var\([^)]*\)/g, ''), pos)
      }
    })
    return findings
  }
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      let owner = node.parent
      while (owner && !ts.isJsxAttribute(owner) && !ts.isVariableDeclaration(owner) && !ts.isPropertyAssignment(owner)) owner = owner.parent
      const classContext = owner && (/className|ClassName/.test(owner.name?.getText(sf) || '') || /(?:Class|CLASS)$/.test(owner.name?.getText(sf) || ''))
      for (const token of node.text.split(/\s+/)) {
        const bare = token.slice(token.lastIndexOf(':') + 1).replace(/^!/, '')
        const match = /^(-?)(p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?|px|\[[^\]]+\])$/.exec(bare)
        if (match) {
          const value = match[3] === 'px' ? 1 : match[3][0] === '[' ? match[3].slice(1, -1) : Number(match[3]) * 4
          spacing(value, node.getStart(sf), bare)
        }
        if (/^duration-\d+$/.test(bare) && !/^duration-(0|120|180|240|500)$/.test(bare)) add('motionScale', bare, node.getStart(sf))
        if ((bare === 'transition' && classContext) || bare === 'transition-all') add('layoutTransition', bare, node.getStart(sf))
        if (/^transition-\[/.test(bare)) layout(bare.slice(12, -1), node.getStart(sf))
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(sf).replace(/['"]/g, '')
      const value = node.initializer
      let parent = node.parent
      while (parent && !ts.isJsxAttribute(parent)) parent = parent.parent
      if (parent?.name.getText(sf) === 'style' && /^(padding|margin)\w*$|^(gap|rowGap|columnGap)$/.test(key)) {
        if (ts.isNumericLiteral(value) || ts.isStringLiteralLike(value)) spacing(value.text, value.getStart(sf))
      }
      if (/^(transition|animation)(Duration|Delay|TimingFunction)?$/.test(key) && ts.isStringLiteralLike(value)) {
        motion(value.text, value.getStart(sf))
        if (key === 'transition') layout(value.text, value.getStart(sf))
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'uiTransition') {
      const props = node.arguments[0]
      if (props && ts.isArrayLiteralExpression(props)) for (const prop of props.elements) if (ts.isStringLiteral(prop)) layout(prop.text, prop.getStart(sf))
    }
    if (ts.isCallExpression(node) && /^(?:React\.)?useEffect$/.test(node.expression.getText(sf)) && !file.endsWith('/useDialogTransition.ts')) {
      const body = node.arguments[0]?.getText(sf) || ''
      if (/set(?:Visible|IsVisible)\(false\)/.test(body) && /setTimeout\([\s\S]*set(?:Mounted|ShouldRender|Rendered)\(false\)/.test(body)) add('manualExit', '复用 useDialogTransition', node.getStart(sf))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

/** 静态令牌的真实消费边；测试、样张与仅转导不算生产使用。 */
function findUnusedTokens(files) {
  const entries = Object.entries(files)
  const production = entries.filter(([file]) => !/\.(?:test|spec)\.|\/devGallery\//.test(file) && file !== 'tailwind.config.js')
  const hits = []
  const styleFile = 'src/components/ui/styleTokens.ts'
  const style = files[styleFile] || ''
  const consumed = new Set()
  for (const [file, raw] of production.filter(([name, text]) => /\.[jt]sx?$/.test(name) && /UI_[A-Z]|styleTokens/.test(text))) {
    const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const aliases = new Map()
    for (const statement of source.statements) if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) aliases.set(specifier.name.text, (specifier.propertyName || specifier.name).text)
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
      if (ts.isIdentifier(node) && !((ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node)) consumed.add(aliases.get(node.text) || node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  for (const match of style.matchAll(/export const (UI_[A-Z0-9_]+)/g)) {
    const value = match[1]
    // UI_SPACING_SCALE 是静态门禁和样张共同读取的刻度契约，不是待用皮肤。
    if (!consumed.has(value) && value !== 'UI_SPACING_SCALE') hits.push({ rule: 'unusedToken', file: styleFile, value })
  }
  // CSS 变量先追 Tailwind 映射，再看生成的语义类是否真的有调用。
  const config = files['tailwind.config.js'] || ''
  const allProduction = production.map(([, text]) => text).join('\n')
  for (const [file, raw] of production.filter(([name]) => name.endsWith('.css'))) {
    for (const value of new Set([...raw.matchAll(/(--ui-[\w-]+)\s*:/g)].map(match => match[1]))) {
      if (allProduction.includes(`var(${value}`)) continue
      const mapped = [...config.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g)].filter(match => match[2].includes(value)).some(match => new RegExp(`(?:^|[\\s'"\x60])(?:[\\w-]+:)*[\\w-]+-${match[1]}(?:[\\s'"\x60]|$)`).test(allProduction))
      if (!mapped) hits.push({ rule: 'unusedToken', file, value })
    }
  }
  return hits
}
module.exports = { findDesignRules, findUnusedTokens, SPACING_EXCEPTIONS, LAYOUT_EXCEPTIONS }
