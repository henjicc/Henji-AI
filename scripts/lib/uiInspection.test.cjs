const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')
const {
  DEFAULT_WINDOW_SIZES,
  UI_INSPECTION_SCENES,
  filterScenes,
  parseUiInspectionArgs,
  parseWindowSize,
  resolveOutputDir,
} = require('./uiInspection.cjs')

test('默认覆盖两档项目窗口尺寸', () => {
  const options = parseUiInspectionArgs([], '.ui-tour')
  assert.deepEqual(options.sizes, DEFAULT_WINDOW_SIZES)
  assert.equal(options.outDir, '.ui-tour')
  assert.deepEqual(options.only, [])
})

test('支持重复尺寸、逗号筛选和自定义输出目录', () => {
  const options = parseUiInspectionArgs([
    '--size',
    '1440x900',
    '--size=1200x800',
    '--only',
    '生成,设置',
    '--out',
    'artifacts/ui',
  ], '.ui-tour')
  assert.deepEqual(options.sizes, [
    { width: 1440, height: 900 },
    { width: 1200, height: 800 },
  ])
  assert.deepEqual(options.only, ['生成', '设置'])
  assert.equal(options.outDir, 'artifacts/ui')
})

test('拒绝格式错误或低于项目下限的尺寸', () => {
  assert.throws(() => parseWindowSize('1440-900'), /无效窗口尺寸/)
  assert.throws(() => parseWindowSize('800x600'), /不能小于项目下限/)
})

test('only 同时匹配场景 id、界面与中文场景名', () => {
  const generationScenes = filterScenes(UI_INSPECTION_SCENES, ['生成'])
  const focusScenes = filterScenes(UI_INSPECTION_SCENES, ['focus'])
  assert.equal(generationScenes.length, 4)
  assert.deepEqual(focusScenes.map((scene) => scene.id).sort(), [
    'assets-search-focus',
    'assistant-focus',
    'generation-prompt-focus',
  ])
})

test('输出目录相对项目根解析且绝对路径保持不变', () => {
  const root = path.resolve('workspace-root')
  const absolute = path.resolve('absolute-output')
  assert.equal(resolveOutputDir(root, '.ui-tour'), path.join(root, '.ui-tour'))
  assert.equal(resolveOutputDir(root, absolute), absolute)
})

test('场景覆盖六类界面且规则数固定为十一条', () => {
  assert.deepEqual([...new Set(UI_INSPECTION_SCENES.map((scene) => scene.surface))].sort(), [
    '助手',
    '工具箱',
    '生成',
    '画布',
    '设置',
    '资产库',
  ])
  assert.equal(UI_AUDIT_RULES.length, 11)
  assert.equal(new Set(UI_AUDIT_RULES.map((rule) => rule.key)).size, 11)
  const sceneIds = new Set(UI_INSPECTION_SCENES.map((scene) => scene.id))
  assert.equal(sceneIds.has('settings-llm'), true)
  assert.equal(sceneIds.has('toolbox-image-edit'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage'), true)
  assert.equal(sceneIds.has('assistant-memory'), true)
})
