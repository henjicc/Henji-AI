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

// —— 5.8 门禁口径：每类规则一组断牙用例（坏样本必须判违规/待登记，好样本必须放行）——

const {
  applyResidueAllowlist,
  classReferencePattern,
  classifyArbitraryValue,
  inlineStyleLiterals,
  surfaceAllowHasReason,
} = require('./uiResidueRules.cjs')

const verdictOf = (token) => classifyArbitraryValue(token).verdict

test('任意值类口径：变量、关键字与相对值合规', () => {
  for (const token of ['rounded-[var(--node-radius)]', 'bg-[var(--lighting-color)]', 'rounded-[inherit]', 'text-[length:inherit]',
    'max-h-[calc(100vh-2rem)]', 'w-[min(92vw,34rem)]', 'h-[1.25em]', 'max-w-[45%]', 'h-[1lh]', 'top-[calc(100%+6px)]']) {
    assert.equal(verdictOf(token), 'allowed', token)
  }
})

test('任意值类口径：视觉档位写死、任意颜色、与标准档等值都是违规（不可登记）', () => {
  for (const token of ['text-[13px]', 'leading-[22px]', 'rounded-[10px]', 'mt-[-4px]', 'gap-[6px]', 'z-[9999]', 'duration-[300ms]',
    'shadow-[0_0_4px_black]', 'bg-[rgb(1,2,3)]', 'text-[#fff]', 'h-[64px]', 'w-[48px]', 'max-w-[20rem]', 'min-w-[14px]',
    '[&::-webkit-slider-thumb]:mt-[-4px]']) {
    assert.equal(verdictOf(token), 'violation', token)
  }
})

test('任意值类口径：固定几何尺寸待登记；rem 不算相对值；原生滑块部件的外边距按几何判', () => {
  for (const token of ['w-[78px]', 'h-[18px]', 'w-[25rem]', 'max-w-[32.5rem]', '-left-[5px]', 'sm:min-h-[52px]',
    '[&::-webkit-slider-thumb]:!mt-[-3px]']) {
    assert.equal(verdictOf(token), 'register', token)
  }
  assert.equal(classifyArbitraryValue('hover:!-mt-[3px]').value, '-mt-[3px]')
})

test('扫描时带上任意变体判定（正则命中不含 [&::…]: 前缀）', () => {
  const [item] = scanSourceText('const c = "[&::-webkit-slider-thumb]:!mt-[-3px]"').filter((entry) => entry.category === 'arbitraryValue')
  assert.equal(item.verdict, 'register')
  assert.equal(item.value, 'mt-[-3px]')
})

test('内联尺寸口径：字面量（含简写串与三元分支）待登记，运行时值与 0 合规', () => {
  assert.deepEqual(inlineStyleLiterals("height: '92px'").sizes, ["height: '92px'"])
  assert.deepEqual(inlineStyleLiterals('height: 420').sizes, ['height: 420'])
  assert.equal(inlineStyleLiterals("padding: compact ? '8px' : '10px 10px 8px'").sizes.length, 1)
  assert.equal(inlineStyleLiterals("padding: open ? '0 16px' : '0 12px'").sizes.length, 1)
  assert.deepEqual(inlineStyleLiterals("width: size.width, height: `${h}px`, left: 0, top: '0px', minHeight: GEN_MIN").sizes, [])
  assert.deepEqual(inlineStyleLiterals("height: tick.major ? '100%' : '40%', width: 'min(100cqw, 100cqh)'").sizes, [])
  const findings = scanSourceText('<div style={{ width: drag.width, height: 92 }} />\n<div style={{ width: drag.width }} />')
  assert.deepEqual(findings.filter((item) => item.category === 'inlineStyleSize').map((item) => item.verdict), ['register', 'allowed'])
})

test('内联颜色口径：字面量颜色违规，运行时数据与令牌变量合规', () => {
  assert.equal(inlineStyleLiterals("color: 'red', background: 'rgb(1 2 3)'").colors.length, 2)
  assert.deepEqual(inlineStyleLiterals("stroke: selected ? 'rgb(var(--accent-rgb))' : 'transparent', background: getSocketColor('IMAGE'), color: settings.textColor").colors, [])
  const findings = scanSourceText("<i style={{ color: 'white' }} />\n<i style={{ color: port.color }} />")
  assert.deepEqual(findings.filter((item) => item.category === 'inlineStyleColor').map((item) => item.verdict), ['violation', 'allowed'])
})

test('调用点覆盖外观：标签内（开始标签到 className 之间）的豁免注释生效，标签外的不生效', () => {
  const inside = scanSourceText([
    '<UiButton',
    '  // ui-surface-allow 上传占位卡：拖放目标表面，不是按钮档位',
    '  type="button"',
    '  onClick={pick}',
    '  className="border-2 border-dashed"',
    '/>',
  ].join('\n'))
  assert.equal(count(inside, 'appearanceOverride'), 0)
  const outside = scanSourceText(['// ui-surface-allow 很早以前的一条豁免，和下面无关', 'const a = 1', 'const b = 2', '<UiButton className="bg-panel" />'].join('\n'))
  assert.equal(count(outside, 'appearanceOverride'), 1)
  assert.equal(outside.find((item) => item.category === 'appearanceOverride').verdict, 'violation')
})

test('行级豁免必须写理由（≥ 8 字），缺理由判违规', () => {
  assert.equal(surfaceAllowHasReason('{/* ui-surface-allow 同上：字幕区间条 */}'), false)
  assert.equal(surfaceAllowHasReason('// ui-surface-allow 字幕区间条：时间轴记号的命中区，不是按钮档位'), true)
  const [item] = scanSourceText('{/* ui-surface-allow 同上 */}')
  assert.equal(item.verdict, 'violation')
})

test('私有 CSS 变量：第三方库主题变量接令牌合规，其余待登记；写死尺寸待登记', () => {
  const findings = scanCssText('.react-flow {\n  --xy-edge-stroke: rgb(var(--text3-rgb));\n  --my-gap: 4px;\n  width: 12px;\n}', 'src/features/a/a.css')
  assert.deepEqual(findings.map((item) => [item.category, item.verdict]), [
    ['privateCssVar', 'allowed'], ['privateCssVar', 'register'], ['privateCssLiteral', 'register'],
  ])
})

test('CSS 类名：includeShared 时 ui-* 也提取（其他样式表里的 ui-* 是私有类，5.4-10）', () => {
  const css = '.ui-panel { } .ui-field { } .speed-option { }'
  assert.deepEqual(extractCssClassNames(css), ['speed-option'])
  assert.deepEqual(extractCssClassNames(css, { includeShared: true }), ['speed-option', 'ui-field', 'ui-panel'])
})

test('类名引用：模板里直接拼状态后缀也算引用（零引用不误报）', () => {
  assert.ok(classReferencePattern('canvas-node-paint-frame').test("className={`canvas-node-paint-frame${active ? ' x' : ''}`}"))
  assert.ok(!classReferencePattern('canvas-node').test('className="canvas-node-paint-frame"'))
})

test('登记文件：按文件 + 类别 + 值放行；过期、违规、不可登记类别、理由过短都报错', () => {
  const build = () => new Map([
    ['src/a.tsx', [
      { category: 'arbitraryValue', value: 'w-[78px]', verdict: 'register' },
      { category: 'arbitraryValue', value: 'text-[13px]', verdict: 'violation', rule: '视觉档位' },
    ]],
    ['src/b.tsx', [{ category: 'privateCssClass', value: 'canvas-lod-low', definedIn: 'src/x.css', verdict: 'register' }]],
  ])
  const ok = build()
  assert.deepEqual(applyResidueAllowlist(ok, {
    version: 1,
    entries: [{ file: 'src/a.tsx', category: 'arbitraryValue', values: ['w-[78px]'], reason: '比例格子固定宽度，网格需等宽' }],
    cssClasses: [{ definedIn: 'src/x.css', names: ['canvas-lod-low'], reason: '画布 LOD 机制，工具类写不出' }],
  }).errors, [])
  assert.equal(ok.get('src/a.tsx')[0].verdict, 'registered')
  assert.equal(ok.get('src/a.tsx')[1].verdict, 'violation')
  assert.equal(ok.get('src/b.tsx')[0].verdict, 'registered')

  const { errors } = applyResidueAllowlist(build(), {
    version: 1,
    entries: [
      { file: 'src/a.tsx', category: 'arbitraryValue', values: ['w-[99px]', 'text-[13px]'], reason: '短' },
      { file: 'src/a.tsx', category: 'legacyCopy', values: ['x'], reason: '旧文案也想登记一下试试' },
    ],
    cssClasses: [{ definedIn: 'src/x.css', names: ['gone-class'], reason: '已经没人用的类还登记着' }],
  })
  assert.equal(errors.length, 5)
  assert.ok(errors.some((error) => /理由少于/.test(error)))
  assert.ok(errors.some((error) => /w-\[99px\].*已不存在/.test(error)))
  assert.ok(errors.some((error) => /text-\[13px\].*不可登记/.test(error)))
  assert.ok(errors.some((error) => /legacyCopy 不可登记/.test(error)))
  assert.ok(errors.some((error) => /gone-class.*已没有使用方/.test(error)))
  assert.equal(applyResidueAllowlist(new Map(), { version: 2 }).errors.length, 1)
})

test('仓库登记文件：每条理由都够长、类别可登记（门禁本身由 check:ui-residue 全量跑）', () => {
  const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/ui-residue.allowlist.json'), 'utf8'))
  const { errors } = applyResidueAllowlist(new Map(), allowlist)
  // 空命中表下只剩“过期”类错误；格式、理由与类别问题必须为零
  assert.deepEqual(errors.filter((error) => !/已不存在|已没有使用方/.test(error)), [])
})
