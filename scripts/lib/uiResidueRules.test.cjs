const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  COLOR_UTILITY_PREFIX,
  LEGACY_ALIAS_COLOR_NAMES,
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
} = require('./uiResidueRules.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const categoriesOf = (findings) => findings.map((finding) => finding.category)
const count = (findings, category) => findings.filter((finding) => finding.category === category).length

test('旧别名类正则与 check:colors 的 legacy 规则同源（文本一致，防止两处漂移）', () => {
  const checker = fs.readFileSync(path.join(ROOT, 'scripts/check-color-tokens.cjs'), 'utf8')
  assert.ok(checker.includes(`const UTILITY_PREFIX = '${COLOR_UTILITY_PREFIX}'`))
  assert.ok(checker.includes(`'${LEGACY_ALIAS_COLOR_NAMES.replace(/\\/g, '\\\\')}'`))
})

test('源码扫描：旧别名、任意值（含 px）、注释行跳过', () => {
  const findings = scanSourceText([
    'const a = "bg-app text-text-muted hover:border-border-dark/40 bg-window"',
    'const b = "h-[37px] w-[calc(100%-8px)] text-[13px] rounded-[var(--r)]"',
    '// bg-app h-[37px] 注释里的不算',
  ].join('\n'))
  assert.equal(count(findings, 'legacyAlias'), 3)
  assert.equal(count(findings, 'arbitraryValue'), 4)
  assert.equal(count(findings, 'arbitraryPx'), 2)
  assert.ok(findings.every((finding) => finding.line !== 3))
})

test('源码扫描：内联 style 分颜色与尺寸，跨行也能识别', () => {
  const findings = scanSourceText([
    '<div style={{ width: 10, color: tokens.port }} />',
    '<div style={{',
    '  transform: `translate(${x}px)`,',
    '  minHeight: 20,',
    '}} />',
    '<div style={{ opacity: 0.5 }} />',
  ].join('\n'))
  assert.deepEqual(findings.filter((item) => item.category.startsWith('inline')).map((item) => [item.category, item.line]), [
    ['inlineStyleColor', 1], ['inlineStyleSize', 1], ['inlineStyleSize', 2],
  ])
})

test('源码扫描：Ui* 组件的 className 外观类算覆盖，布局类不算，原生/非 Ui 组件不算，行级豁免跳过', () => {
  const findings = scanSourceText([
    '<UiPanel className="shadow-panel flex-1 px-3" />',
    '<UiButton variant="ghost" className="w-full justify-start" />',
    '<div className="bg-panel rounded-lg" />',
    '<Dropdown buttonClassName="border-none bg-transparent" />',
    '{/* ui-surface-allow 测试豁免 */}',
    '<UiInput className="!bg-transparent" />',
    '<UiTextArea',
    '  onChange={(event) => setValue(event.target.value)}',
    '  className={`text-xs ${extra}`}',
    '/>',
  ].join('\n'))
  assert.deepEqual(findings.filter((item) => item.category === 'appearanceOverride').map((item) => item.text), [
    '<UiPanel> shadow-panel', '<Dropdown> border-none bg-transparent', '<UiTextArea> text-xs',
  ])
  assert.equal(count(findings, 'surfaceAllow'), 1)
})

test('开始标签定位：箭头函数里的 => 不当作标签结束，已闭合的标签不归属', () => {
  const source = '<UiButton onClick={() => run()} className="x" />'
  assert.equal(enclosingTagName(source, source.indexOf('className')), 'UiButton')
  const closed = '<UiPanel>\n  <span className="x" />'
  assert.equal(enclosingTagName(closed, closed.indexOf('className')), 'span')
})

test('旧文案：只算字符串里的用户可见文案，日志、注释与别名不算', () => {
  assert.equal(isLegacyCopyLine("throw new Error('工具箱会话无效')"), true)
  assert.equal(isLegacyCopyLine("logger.warn('工具箱启动')"), false)
  assert.equal(isLegacyCopyLine('// 工具箱旧名'), false)
  assert.equal(isLegacyCopyLine("aliases: ['工具箱']"), false)
  assert.equal(isLegacyCopyLine('const label = tools // 工具箱'), false)
  assert.deepEqual(categoriesOf(scanLocaleJson('{\n  "a": "打开工具箱",\n  "工具箱": "工具"\n}')), ['legacyCopy'])
})

test('CSS 扫描：令牌定义文件只查旧变量；组件样式统计私有变量、写死尺寸与豁免行', () => {
  const css = ['.x {', '  --private: 4px;', '  width: 12px;', '  color: var(--text1);', '  padding: 0;', '}', '/* ui-surface-allow 测试 */'].join('\n')
  assert.deepEqual(categoriesOf(scanCssText(css, 'src/components/a/styles.css')), ['privateCssVar', 'privateCssLiteral', 'surfaceAllow'])
  assert.deepEqual(categoriesOf(scanCssText(css, 'src/index.css')), ['surfaceAllow'])
  assert.deepEqual(categoriesOf(scanCssText(':root { --app-rgb: 1 2 3; }', 'src/index.css')), ['legacyCssVar'])
})

test('CSS 类名：排除共享 ui-*、第三方前缀、状态修饰与 Tailwind 同名类', () => {
  const css = '.speed-option.active, .ui-glass, .react-flow__node, .dv-tab { } @media (x) { .volume-track:hover { } } .is-closing{} .fixed{} /* .commented {} */'
  assert.deepEqual(extractCssClassNames(css), ['speed-option', 'volume-track'])
})

test('引用解析：相对路径、@/ 别名、目录 index 与查询后缀', () => {
  const known = new Set(['src/components/ui/index.ts', 'src/features/a/Panel.tsx', 'src/workers/x.worker.ts'])
  const specifiers = extractImportSpecifiers([
    "import { A } from '@/components/ui'",
    "export { B } from './Panel'",
    "const W = new Worker(new URL('../../workers/x.worker.ts?worker', import.meta.url))",
    "const lazy = import('react')",
  ].join('\n'))
  assert.deepEqual(specifiers.map((specifier) => resolveImport(specifier, 'src/features/a/index.ts', known)).sort(),
    [null, 'src/components/ui/index.ts', 'src/features/a/Panel.tsx', 'src/workers/x.worker.ts'].sort())
})

test('区域：按 5.1 界面表最长路径前缀归属，未登记文件按目录兜底', () => {
  const inventory = parseRegionInventory([
    '##### 生成（5.3）',
    '| 编号 | 界面 | 主要文件（src/ 下） |',
    '|---|---|---|',
    '| G07 | 底栏参数条 | `components/params/ParamRenderer.tsx`、`components/params/base/` | x |',
    '##### 通用弹窗、菜单、查看器与独立窗口（5.7）',
    '| U16 | 共享组件 | `components/ui/primitives.tsx`、`components/ui/Dropdown.tsx` | x |',
    '| U03 | 确认弹窗 | `components/ui/Dropdown.tsx` | x |',
  ].join('\n'))
  assert.deepEqual(inventory.map((entry) => [entry.id, entry.region, entry.paths.length]), [['G07', '5.3', 2], ['U16', '5.7', 2], ['U03', '5.7', 1]])
  assert.deepEqual(resolveRegion('src/components/params/base/RadioInput.tsx', inventory), { region: '5.3', regionLabel: '生成', surfaces: ['G07'] })
  assert.deepEqual(resolveRegion('src/components/ui/Dropdown.tsx', inventory).surfaces, ['U16', 'U03'])
  assert.equal(resolveRegion('src/features/canvas/x.tsx', inventory).region, '5.4')
  assert.equal(resolveRegion('src/core/x.ts', inventory).regionLabel, '未归属')
})

test('区域：仓库里的 5.1 盘点能解析出全部 117 个界面', () => {
  const file = path.join(ROOT, 'docs/task/界面重设计与主题引擎/任务/第五阶段-全界面核对与旧界面清零/5.1-全界面清单与残留盘点.md')
  if (!fs.existsSync(file)) return
  const inventory = parseRegionInventory(fs.readFileSync(file, 'utf8'))
  assert.equal(inventory.length, 117)
  assert.deepEqual([...new Set(inventory.map((entry) => entry.region))], ['5.3', '5.4', '5.5', '5.6', '5.7'])
})
