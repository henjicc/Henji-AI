const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('规则 E 覆盖 UI barrel 的每个组件，漏登记及无理由豁免阻断', () => {
  const ts = require('typescript')
  const { CHECKED_ATTRIBUTES, RULE_E_EXEMPT } = require('./buttonAppearanceOverrides.cjs')
  const components = new Set()
  const visited = new Set()
  const scan = file => {
    if (visited.has(file)) return
    visited.add(file)
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of sf.statements) {
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const item of statement.exportClause.elements) if (!item.isTypeOnly && /^[A-Z][a-z]/.test(item.name.text)) components.add(item.name.text)
        } else if (statement.moduleSpecifier) {
          const base = path.resolve(path.dirname(file), statement.moduleSpecifier.text)
          const target = [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(fs.existsSync)
          assert.ok(target, base)
          scan(target)
        }
      }
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && /^[A-Z][a-z]/.test(statement.name.text)) components.add(statement.name.text)
      if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name) && /^[A-Z][a-z]/.test(item.name.text)) components.add(item.name.text)
    }
  }
  scan(path.join(root, 'src/components/ui/index.ts'))
  assert.ok(components.size > 40, '必须扫描 export * 的实际组件，不只检查 barrel 字面名字')
  const missing = [...components].filter(name => !CHECKED_ATTRIBUTES[name] && !RULE_E_EXEMPT?.[name])
  assert.deepEqual(missing, [], `漏登记：${missing.join('、')}`)
  for (const [name, reason] of Object.entries(RULE_E_EXEMPT)) {
    assert.ok(components.has(name), `过期豁免：${name}`)
    assert.ok(reason.length >= 8, `缺少豁免原因：${name}`)
    assert.equal(CHECKED_ATTRIBUTES[name], undefined, `已受检组件不能重复豁免：${name}`)
  }
})

test('原生控件禁令只豁免原语与测试，且不关闭原有令牌规则', async () => {
  const { ESLint } = require('eslint')
  const lint = new ESLint({ cwd: root })
  const baseSelectors = JSON.parse(fs.readFileSync(path.join(root, '.eslintrc.json'), 'utf8')).rules['no-restricted-syntax'].slice(1)
  for (const file of ['src/features/NativeControl.tsx', 'src/components/ui/NativeControl.tsx']) {
    const rules = (await lint.calculateConfigForFile(file)).rules['no-restricted-syntax']
    for (const original of baseSelectors) assert.ok(rules.some(rule => rule.selector === original.selector && rule.message === original.message), '原有令牌选择器不得降级或遗漏')
    for (const tag of ['button', 'input', 'select', 'textarea']) {
      const [result] = await lint.lintText(`export const Sample = () => <${tag} />`, { filePath: file })
      assert.ok(result.messages.some(item => item.ruleId === 'no-restricted-syntax' && item.severity === 2 && /原生控件/.test(item.message)), `${file}: ${tag}`)
    }
  }
  for (const file of ['src/components/ui/primitives.tsx', 'src/features/NativeControl.test.tsx']) {
    const [result] = await lint.lintText('export const Sample = () => <button className="duration-200" />', { filePath: file })
    assert.ok(result.messages.every(item => !/原生控件/.test(item.message)))
    assert.ok(result.messages.some(item => /动效时长/.test(item.message)), '原有令牌规则仍应生效')
  }
})

test('CI 路径过滤重新纳入两侧 skill，普通文档仍跳过', () => {
  const yaml = require('yaml')
  const { minimatch } = require('minimatch')
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8'))
  assert.equal(workflow.on.push['paths-ignore'], undefined)
  const included = file => (workflow.on.push.paths ?? []).reduce((matches, pattern) => {
    const negative = pattern.startsWith('!')
    return minimatch(file, negative ? pattern.slice(1) : pattern, { dot: true }) ? !negative : matches
  }, false)
  for (const file of ['.codex/skills/henji-ui-surface/SKILL.md', '.claude/skills/henji-ui-surface/references/review.md', '.codex/skills/tool/agents/openai.yaml', 'src/App.tsx']) assert.equal(included(file), true, file)
  for (const file of ['README.md', 'AGENTS.md', 'docs/rules/testing.md', 'docs/ref/a.png']) assert.equal(included(file), false, file)
})

test('CI 规则审计试运行复用 Electron 正式入口，不引入像素基线', () => {
  const workflow = require('yaml').parse(fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8'))
  assert.equal(workflow.on.workflow_dispatch.inputs.audit_ui_rules.default, false)
  const audit = workflow.jobs['ui-rule-audit']
  assert.match(audit.if, /workflow_dispatch.*inputs\.audit_ui_rules/)
  const commands = audit.steps.map(item => item.run ?? '').join('\n')
  assert.match(commands, /npm run electron:bundle/)
  assert.match(commands, /xvfb-run -a npm run test:ui-visual-rules/)
  assert.match(commands, /xvfb-run -a npm run check:ui-visual.*--only 设置.*--theme-preset graphite,paper/)
  assert.doesNotMatch(commands, /baseline|--update|--accept|continue-on-error/)
  assert.ok(audit.steps.some(item => item.if === 'always()' && item.uses === 'actions/upload-artifact@v4'))
})

test('规则 E 已接入的字段对动态 className 与高度覆盖应用相同口径', () => {
  const { findButtonAppearanceOverridesInSource } = require('./buttonAppearanceOverrides.cjs')
  for (const name of ['UiSelect', 'UiSwitch', 'UiSeedInput', 'UiDatePicker']) {
    const hits = findButtonAppearanceOverridesInSource(`<${name} className={active ? 'h-8' : 'bg-panel'} />`, 'Fields.tsx')
    assert.equal(hits.length, 1, name)
    assert.equal(hits[0].violations.length, 2, name)
    assert.equal(findButtonAppearanceOverridesInSource(`<${name} className="w-full flex-1" />`, 'Fields.tsx').length, 0)
  }
})

test('surface CLI 默认严格，report 显式告警，局部检查不吞文件参数', () => {
  const { spawnSync } = require('node:child_process')
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const fixture = fs.mkdtempSync(path.join(root, '.tmp', 'surface-test-'))
  try {
    fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'src/bad.tsx'), '<div className="border rounded-control bg-panel" />')
    fs.writeFileSync(path.join(fixture, 'src/good.tsx'), '<div className="flex" />')
    const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/check-surface-tokens.cjs'), ...args], { cwd: fixture, encoding: 'utf8' })
    assert.equal(run([]).status, 1)
    assert.equal(run(['--report']).status, 0)
    assert.equal(run(['--files', 'src/good.tsx']).status, 0)
    assert.equal(run(['--files', 'src/bad.tsx']).status, 1)
    assert.equal(run(['--unknown']).status, 1)
  } finally {
    assert.equal(path.dirname(fixture), path.join(root, '.tmp'))
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('规则 C 按遮罩元素结构判定，不能被其它位置的 UiModal 名字放行', () => {
  const { spawnSync } = require('node:child_process')
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const fixture = fs.mkdtempSync(path.join(root, '.tmp', 'surface-dialog-'))
  try {
    fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
    const file = path.join(fixture, 'src/dialog.tsx')
    const run = source => {
      fs.writeFileSync(file, source)
      return spawnSync(process.execPath, [path.join(root, 'scripts/check-surface-tokens.cjs'), '--strict'], { cwd: fixture, encoding: 'utf8' })
    }
    for (const source of ['<div role="dialog" className="fixed inset-0 bg-scrim"/>', 'import { UiModal } from "ui"; <div className="fixed inset-0 bg-media"/>', '<div aria-modal="true" className="fixed inset-0"/>', 'const MASK = "fixed inset-0 bg-scrim"; <div className={MASK}/>']) {
      const result = run(source)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /\[C\]/)
    }
    assert.equal(run('<UiModal><div className="fixed inset-0 bg-scrim"/></UiModal>').status, 0)
    assert.equal(run('import { UiModal as Modal } from "ui"; <Modal><div className="fixed inset-0 bg-scrim"/></Modal>').status, 0)
    assert.equal(run('<div aria-modal={false} className="fixed inset-0"/>').status, 0)
    assert.equal(run('<div className="fixed inset-0 pointer-events-none"/>').status, 0)
    assert.equal(run('<div className="fixed inset-0 bg-media-control"/>').status, 0)
    assert.equal(run('<div className={/* ui-surface-allow: 全屏媒体查看器由任务5.2接手审查 */ "fixed inset-0 bg-media"}/>').status, 0)
  } finally {
    assert.equal(path.dirname(fixture), path.join(root, '.tmp'))
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('electron:bundle 只生成运行产物，不暗中执行完整质量门禁', () => {
  const script = packageJson.scripts['electron:bundle']
  assert.equal(script, 'node scripts/run-electron-bundle.cjs')
  assert.doesNotMatch(script, /check:|vitest|\btsc\b|\blint\b|electron:build/)
})

test('发布构建仍保留完整静态与助手能力门禁', () => {
  const script = packageJson.scripts['electron:build']
  assert.match(script, /check:assistant-capabilities/)
  assert.match(script, /check:sdk/)
  assert.match(script, /tsc -p tsconfig\.electron\.json/)
  assert.match(script, /electron-vite build/)
  assert.match(script, /build:video-decoder/)
})

test('build:video-decoder 与轻量构建共用同一构建入口', () => {
  assert.equal(packageJson.scripts['build:video-decoder'], 'node scripts/video-decoder-ffmpeg.cjs build')
})
