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
  selectInspectionScenes,
} = require('./uiInspection.cjs')

test('默认覆盖两档项目窗口尺寸', () => {
  const options = parseUiInspectionArgs([], '.ui-tour')
  assert.deepEqual(options.sizes, DEFAULT_WINDOW_SIZES)
  assert.equal(options.outDir, '.ui-tour')
  assert.deepEqual(options.only, [])
  assert.equal(options.profile, 'temporary')
  assert.equal(options.allowWrites, false)
})

test('真实数据模式必须显式开启，写业务数据的场景默认被拦截', () => {
  const options = parseUiInspectionArgs(['--real-data'], '.ui-tour')
  assert.equal(options.profile, 'real')
  const selection = selectInspectionScenes([
    { id: 'read', name: '只读', setup() {} },
    { id: 'write', name: '写入', writesUserData: true, setup() {} },
  ], options)
  assert.deepEqual(selection.scenes.map((scene) => scene.id), ['read'])
  assert.deepEqual(selection.blocked.map((scene) => scene.id), ['write'])

  const allowed = selectInspectionScenes([...selection.scenes, ...selection.blocked], {
    ...options,
    allowWrites: true,
  })
  assert.deepEqual(allowed.scenes.map((scene) => scene.id).sort(), ['read', 'write'])
})

test('拒绝未知的数据模式', () => {
  assert.throws(() => parseUiInspectionArgs(['--profile', 'production'], '.ui-tour'), /temporary 或 real/)
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
  assert.equal(generationScenes.length, 11)
  assert.deepEqual(focusScenes.map((scene) => scene.id).sort(), [
    'assets-search-focus',
    'assistant-focus',
    'generation-prompt-focus',
  ])
})

test('Midjourney 参数面板场景可在真实资料模式下只读运行', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'generation-midjourney-settings')
  assert.ok(scene)
  assert.notEqual(scene.writesUserData, true)
  const selection = selectInspectionScenes([scene], parseUiInspectionArgs([
    '--profile',
    'real',
    '--only',
    'Midjourney',
  ], '.ui-tour'))
  assert.deepEqual(selection.scenes.map((candidate) => candidate.id), ['generation-midjourney-settings'])
  assert.deepEqual(selection.blocked, [])
})

test('模型合并与参考图状态都有定向视觉场景', () => {
  const sceneIds = UI_INSPECTION_SCENES.map((scene) => scene.id)
  assert.equal(sceneIds.includes('generation-model-midjourney'), true)
  assert.equal(sceneIds.includes('generation-model-gemini-omni'), true)
  assert.equal(sceneIds.includes('generation-model-gpt-image-2'), true)
  assert.equal(sceneIds.includes('generation-midjourney-reference'), true)
  assert.equal(sceneIds.includes('generation-gpt-mask-control'), true)
  assert.equal(sceneIds.includes('generation-gpt-mask-editor'), true)
})

test('GPT Image 2 遮罩在生成页与画布都有定向视觉场景', () => {
  const generationScenes = UI_INSPECTION_SCENES.filter((scene) => scene.id.startsWith('generation-gpt-mask-'))
  const canvasScene = UI_INSPECTION_SCENES.find((scene) => scene.id === 'canvas-gpt-mask-editor')
  assert.equal(generationScenes.length, 2)
  assert.equal(generationScenes.every((scene) => scene.writesUserData !== true), true)
  assert.ok(canvasScene)
  assert.equal(canvasScene.writesUserData, true)
})

test('全景结果有独立的真实 Electron 球面交互场景', () => {
  const toolbarScene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-panorama-toolbar')
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-panorama-viewer')
  assert.ok(toolbarScene)
  assert.equal(toolbarScene.writesUserData, true)
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('图片打光有独立的节点、编辑、保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-relight-editor')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('多角度有独立的节点、草稿取消、相机编辑与保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-multi-angle-editor')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('高清放大有独立的工具条、节点与保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-upscale-node')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('画布 Midjourney 场景只操作可清理的专用工程，真实只读巡检会跳过', () => {
  const scenes = UI_INSPECTION_SCENES.filter((scene) => scene.id.startsWith('canvas-midjourney-'))
  assert.deepEqual(scenes.map((scene) => scene.id), [
    'canvas-midjourney-node',
    'canvas-midjourney-settings',
  ])
  assert.equal(scenes.every((scene) => scene.writesUserData === true), true)
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
  assert.equal(sceneIds.has('generation-model-panel'), true)
  assert.equal(sceneIds.has('generation-midjourney-settings'), true)
  assert.equal(sceneIds.has('canvas-midjourney-node'), true)
  assert.equal(sceneIds.has('canvas-midjourney-settings'), true)
  assert.equal(sceneIds.has('settings-provider-center'), true)
  assert.equal(sceneIds.has('settings-provider-manager'), true)
  assert.equal(sceneIds.has('toolbox-image-edit'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage-lineart'), true)
  assert.equal(sceneIds.has('assistant-memory'), true)
})
