const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  buildDevSurfaceUrl,
  compileStepScene,
  expandTemplate,
  filterVariants,
  loadStepSpecFile,
  normalizeStep,
  normalizeStepSpec,
  parsePattern,
  pointInBox,
  sanitizeSuffix,
  variantId,
} = require('./uiReviewSteps.cjs')
const {
  DEFAULT_UI_INSPECTION_DISPLAY_POINT,
  UI_REVIEW_MATRICES,
  parseUiInspectionArgs,
  resolveDisplayPoint,
  resolveInspectionRuns,
} = require('./uiInspection.cjs')
const { REQUIRED_REVIEW_HELPERS, createReviewStepContext } = require('./uiReviewContext.cjs')

const vm = require('node:vm')
const { PAID_GENERATION_CHANNELS } = require('./uiReviewPaidGuard.cjs')

const ROOT = path.resolve(__dirname, '..', '..')

/** 主进程 ipcMain 的同形替身：handle/removeHandler 写同一张表；evaluate 在独立上下文里执行回调，与真实 evaluate 一样不能借用外部变量。 */
function fakeElectronApp() {
  const calls = []
  const production = Object.fromEntries(PAID_GENERATION_CHANNELS.map((channel) => [channel, async (_event, request) => {
    calls.push({ channel, request })
    return { ok: true, data: { status: 'completed' } }
  }]))
  const handlers = new Map(Object.entries(production))
  const ipcMain = { _invokeHandlers: handlers, removeHandler: (name) => handlers.delete(name), handle: (name, callback) => {
    if (handlers.has(name)) throw new Error(`重复登记 ${name}`)
    handlers.set(name, callback)
  } }
  const sandbox = vm.createContext({ RegExp, Error, Object, String })
  const app = { evaluate: async (fn, args) => vm.runInContext(`(${fn.toString()})`, sandbox)({ ipcMain }, args) }
  return { app, handlers, production, calls, sandbox }
}

test('步骤：简写与完整写法规范化为同一结构，未知动作与多动作报错', () => {
  assert.deepEqual(normalizeStep({ enter: 'generation' }, 's'), {
    action: 'enter', optional: false, timeout: 8000, ifPresent: null, workspace: 'generation', surface: null, media: null,
  })
  const click = normalizeStep({ click: { role: 'button', name: '/^生成$/' }, optional: true, timeout: 1200 }, 's')
  assert.equal(click.optional, true)
  assert.equal(click.timeout, 1200)
  assert.equal(click.target.role, 'button')
  assert.equal(normalizeStep({ capture: 'bar' }, 's').name, 'bar')
  assert.throws(() => normalizeStep({ tap: {} }, 's'), /未知动作 tap/)
  assert.throws(() => normalizeStep({ click: { role: 'button' }, hover: { role: 'button' } }, 's'), /只能有一个动作/)
  assert.throws(() => normalizeStep({ capture: 'Bar_1' }, 's'), /capture.name/)
  assert.throws(() => normalizeStep({ enter: 'settings' }, 's'), /enter.workspace/)
  assert.throws(() => normalizeStep({ enter: { surface: 'bad id' } }, 's'), /Surface ID/)
  assert.throws(() => normalizeStep({ click: { name: '生成' } }, 's'), /role \/ text/)
  assert.throws(() => normalizeStep({ click: { role: 'button', colour: 'red' } }, 's'), /未知定位字段：colour/)
  assert.throws(() => normalizeStep({ click: { role: 'button', nth: -1 } }, 's'), /nth/)
})

test('步骤：拖动、指标与 ifPresent 的参数校验', () => {
  const drag = normalizeStep({ drag: { from: { selector: '.a' }, to: { dx: 10, dy: -5 }, release: false } }, 's')
  assert.deepEqual(drag.to, { dx: 10, dy: -5 })
  assert.equal(drag.release, false)
  assert.equal(drag.steps, 8)
  assert.throws(() => normalizeStep({ drag: { to: { dx: 1 } } }, 's'), /drag 需要 from/)
  const metrics = normalizeStep({ capture: { name: 'bar', metrics: { selector: '.bar', maxRows: null } } }, 's').metrics
  assert.deepEqual(metrics, { target: { selector: '.bar', within: undefined, commonAncestorWith: undefined }, maxRows: null })
  assert.equal(normalizeStep({ metrics: { name: 'menu', target: { role: 'listbox' } } }, 's').metrics.maxRows, 1)
  assert.throws(() => normalizeStep({ metrics: { name: 'menu', selector: '.a', maxRows: 0 } }, 's'), /maxRows/)
  assert.equal(normalizeStep({ capture: 'more', ifPresent: { role: 'button', name: '更多' } }, 's').ifPresent.name, '更多')
})

test('步骤：stubDialogs 默认替换保存对话框，open 需要非空文件数组', () => {
  const plain = normalizeStep({ stubDialogs: {} }, 's')
  assert.equal(plain.save, true)
  assert.equal(plain.open, null)
  const withOpen = normalizeStep({ stubDialogs: { save: false, open: ['docs/ref/test01.jpg'] } }, 's')
  assert.equal(withOpen.save, false)
  assert.deepEqual(withOpen.open, ['docs/ref/test01.jpg'])
  assert.throws(() => normalizeStep({ stubDialogs: { open: [] } }, 's'), /非空文件数组/)
})

test('步骤：seedAudioEdit 需要工程名，默认带逐字稿', () => {
  assert.deepEqual(
    { name: normalizeStep({ seedAudioEdit: { name: '核对-口播' } }, 's').name, transcript: normalizeStep({ seedAudioEdit: { name: '核对-口播' } }, 's').transcript },
    { name: '核对-口播', transcript: true },
  )
  assert.equal(normalizeStep({ seedAudioEdit: { name: '空', transcript: false } }, 's').transcript, false)
  assert.throws(() => normalizeStep({ seedAudioEdit: {} }, 's'), /需要 name/)
})

test('定位：/正则/ 字符串解析为 RegExp，其余原样', () => {
  assert.deepEqual(parsePattern('/^模型：/i'), /^模型：/i)
  assert.equal(parsePattern('生成'), '生成')
  assert.equal(parsePattern('/没有结尾'), '/没有结尾')
})

test('模板：变体字段替换到深层字符串，缺字段报错', () => {
  const expanded = expandTemplate({ selectModel: { modelId: '{{modelId}}', list: ['{{ providerId }}-x'] } }, { modelId: 'kie-a', providerId: 'kie' })
  assert.deepEqual(expanded, { selectModel: { modelId: 'kie-a', list: ['kie-x'] } })
  assert.throws(() => expandTemplate('{{missing}}', {}), /\{\{missing\}\}/)
})

test('变体：后缀清洗、id 生成、include/exclude/limit 与重名去重', () => {
  assert.equal(sanitizeSuffix('black-forest-labs/FLUX.1-Krea-dev'), 'black-forest-labs-flux-1-krea-dev')
  assert.equal(variantId({ providerId: 'kie', modelId: 'kie-seedance-2.0' }, 0), 'kie-kie-seedance-2-0')
  assert.equal(variantId({}, 2), 'variant-3')
  const list = [
    { id: 'kie-a', modelId: 'kie-seedance-2.0', providerId: 'kie' },
    { id: 'fal-a', modelId: 'fal-seedance-2.0', providerId: 'fal' },
    { id: 'kie-a', modelId: 'kie-seedance-2.0-fast', providerId: 'kie' },
    { id: 'kie-b', modelId: 'kie-gpt-image-2', providerId: 'kie' },
  ]
  assert.deepEqual(filterVariants(list, { include: ['/seedance/'] }).map((item) => item.id), ['kie-a', 'fal-a', 'kie-a-2'])
  assert.deepEqual(filterVariants(list, { include: ['seedance'], exclude: ['fal'] }).map((item) => item.modelId),
    ['kie-seedance-2.0', 'kie-seedance-2.0-fast'])
  assert.equal(filterVariants(list, { limit: 2 }).length, 2)
})

test('enter.surface：开发导航参数写进 URL，保留主题预设，素材转绝对路径', () => {
  const url = buildDevSurfaceUrl('file:///app/index.html?henjiDevThemePreset=paper&henjiDevMedia=old',
    { surface: 'tool.image_edit', media: 'docs/ref/test01.jpg' }, path.resolve(path.sep, 'repo'))
  const params = new URL(url).searchParams
  assert.equal(params.get('henjiDevSurface'), 'tool.image_edit')
  assert.equal(params.get('henjiDevThemePreset'), 'paper')
  assert.equal(params.get('henjiDevMedia'), path.resolve(path.sep, 'repo', 'docs/ref/test01.jpg'))
  assert.equal(new URL(buildDevSurfaceUrl(url, { surface: 'workspace.canvas' })).searchParams.has('henjiDevMedia'), false)
})

test('描述文件：结构校验在模板替换前完成，id 与 steps 必填', () => {
  assert.throws(() => normalizeStepSpec({ id: 'Bad Id', surface: 'x', name: 'y', steps: [{ capture: 'a' }] }), /id 只能/)
  assert.throws(() => normalizeStepSpec({ id: 'a', surface: 'x', name: 'y', steps: [] }), /steps 不能为空/)
  assert.throws(() => normalizeStepSpec({ id: 'a', surface: 'x', name: 'y', steps: [{ capture: 'a' }], variants: { source: 'nope' } }), /未知变体来源/)
  const spec = normalizeStepSpec({ id: 'a', surface: 'x', name: 'y', steps: [{ capture: '{{id}}-bar' }], variants: [{ modelId: 'm', providerId: 'p' }] })
  assert.equal(spec.variants.list[0].id, 'p-m')
})

test('样例步骤描述全部可解析（Seedance KIE、画布节点、全模型批量）', () => {
  const dir = path.join(ROOT, 'scripts/ui-review')
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 3)
  const specs = files.flatMap((name) => loadStepSpecFile(path.join('scripts/ui-review', name), ROOT))
  assert.equal(new Set(specs.map((spec) => spec.id)).size, specs.length)
  const allModels = specs.find((spec) => spec.id === 'review-generation-all-models')
  assert.equal(allModels.variants.source, 'generation-models')
  assert.equal(specs.find((spec) => spec.id === 'review-canvas-image-node-rows').writesUserData, true)
})

test('编译场景：变体逐个执行并加前缀，单个变体失败不中断其余变体，最后汇总失败', async () => {
  const captures = []
  const metrics = []
  const closed = []
  const page = { waitForTimeout: async () => undefined, mouse: { up: async () => undefined } }
  const context = { closeTransientUi: async () => { closed.push(true) }, settlePage: async () => undefined }
  const spec = normalizeStepSpec({
    id: 'fake', surface: '测试', name: '测试-变体',
    variants: [{ id: 'ok' }, { id: 'bad', fail: 'yes' }, { id: 'ok2' }],
    steps: [{ wait: 1 }, { capture: 'bar' }, { capture: '{{id}}-tail' }],
  })
  const scene = compileStepScene(spec, context)
  const ctx = {
    capture: async (suffix) => {
      if (suffix === 'bad-bar') throw new Error('截图失败')
      captures.push(suffix)
    },
    recordMetrics: (value) => metrics.push(value),
  }
  await assert.rejects(scene.setup(page, fakeElectronApp().app, ctx), /1\/3 个变体失败：bad：截图失败/)
  assert.deepEqual(captures, ['ok-bar', 'ok-ok-tail', 'ok2-bar', 'ok2-ok2-tail'])
  assert.equal(closed.length, 3)
  assert.deepEqual(metrics, [])
})

test('核对矩阵：review = 石墨 1440+960 与其余三个预设 1440；与 --size/--theme-preset 互斥', () => {
  const options = parseUiInspectionArgs(['--matrix', 'review'], '.ui-tour')
  const runs = resolveInspectionRuns(options, path.resolve(path.sep, 'out'))
  assert.deepEqual(runs.map((run) => [run.themePreset, run.sizes.map((size) => `${size.width}x${size.height}`)]), [
    ['graphite', ['1440x900', '960x640']], ['ocean', ['1440x900']], ['film', ['1440x900']], ['paper', ['1440x900']],
  ])
  assert.equal(runs[1].outDir, path.join(path.resolve(path.sep, 'out'), 'ocean'))
  const screen = resolveInspectionRuns(parseUiInspectionArgs(['--matrix=screen'], '.ui-tour'), 'o')
  assert.deepEqual(screen.map((run) => [run.themePreset, run.outDir, run.sizes.length]), [['graphite', 'o', 2]])
  assert.throws(() => parseUiInspectionArgs(['--matrix', 'review', '--size', '960x640'], '.ui-tour'), /不能再同时传/)
  assert.throws(() => parseUiInspectionArgs(['--matrix', 'all'], '.ui-tour'), /--matrix 仅支持/)
  assert.deepEqual(Object.keys(UI_REVIEW_MATRICES), ['review', 'screen'])
  const plain = resolveInspectionRuns(parseUiInspectionArgs(['--theme-preset', 'paper', '--size', '960x640'], '.ui-tour'), 'o')
  assert.deepEqual(plain.map((run) => [run.themePreset, run.sizes]), [['paper', [{ width: 960, height: 640 }]]])
})

test('参数：--steps 可重复与逗号分隔，--contrast，副屏坐标默认值与覆盖', () => {
  const options = parseUiInspectionArgs(['--steps', 'a.json,b.json', '--steps=c.cjs', '--contrast'], '.ui-tour')
  assert.deepEqual(options.steps, ['a.json', 'b.json', 'c.cjs'])
  assert.equal(options.contrast, true)
  assert.equal(resolveDisplayPoint(undefined, {}), DEFAULT_UI_INSPECTION_DISPLAY_POINT)
  assert.equal(resolveDisplayPoint(undefined, { HENJI_DEV_DISPLAY_POINT: '-1920,10' }), '-1920,10')
  assert.equal(resolveDisplayPoint('100,200', { HENJI_DEV_DISPLAY_POINT: '1,1' }), '100,200')
  assert.equal(resolveDisplayPoint('none', {}), null)
  assert.throws(() => resolveDisplayPoint('left', {}), /--display-point/)
})

test('步骤上下文：复用正式场景的助手，缺失时立即报错', () => {
  const context = createReviewStepContext({ canvasFixtureProjectId: 'fixture', settlePage: async () => undefined })
  for (const name of REQUIRED_REVIEW_HELPERS) assert.equal(typeof context[name], 'function', name)
})

test('助手夹具与文件输入：seedAssistant 回复脚本校验、setFiles 默认可定位隐藏输入', () => {
  const seed = normalizeStep({ seedAssistant: { capabilities: ['image'], memory: '偏好', replies: [
    { thinking: '想一想', hold: true, tool: { name: 'read_application_entity', arguments: { a: 1 } } },
    { partial: '半截', hold: true, content: '后半' },
    { error: { status: 500 } },
  ] } }, 's')
  assert.equal(seed.action, 'seedAssistant')
  assert.deepEqual(seed.capabilities, ['image'])
  assert.equal(seed.newConversation, true)
  assert.deepEqual(seed.replies[0].tool, { name: 'read_application_entity', arguments: { a: 1 } })
  assert.equal(seed.replies[2].error.message, '替身返回错误')
  assert.throws(() => normalizeStep({ seedAssistant: { replies: [{ tool: { name: 'x' }, content: 'y' }] } }, 's'), /不能同时有 tool 与 content/)
  assert.throws(() => normalizeStep({ seedAssistant: { replies: [{ text: 'x' }] } }, 's'), /未知字段：text/)
  assert.throws(() => normalizeStep({ seedAssistant: { replies: [{ error: { status: 200 } }] } }, 's'), /error.status/)
  assert.throws(() => normalizeStep({ seedAssistant: { capabilities: ['pdf'] } }, 's'), /capabilities/)
  assert.equal(normalizeStep({ releaseAssistant: {} }, 's').action, 'releaseAssistant')
  const files = normalizeStep({ setFiles: { target: { selector: 'input[type=file]' }, files: ['a.png'] } }, 's')
  assert.equal(files.target.includeHidden, true)
  assert.deepEqual(files.files, ['a.png'])
  assert.throws(() => normalizeStep({ setFiles: { target: { selector: 'input' }, files: [] } }, 's'), /files 数组/)
})

test('步骤描述：expectedLogEvents 透传到场景，格式错误报错', () => {
  const spec = normalizeStepSpec({ id: 'a', surface: 'x', name: 'y', expectedLogEvents: ['embedded_agent.turn.failed'], steps: [{ capture: 'a' }] })
  assert.deepEqual(compileStepScene(spec, {}).expectedLogEvents, ['embedded_agent.turn.failed'])
  assert.equal('expectedLogEvents' in compileStepScene(normalizeStepSpec({ id: 'b', surface: 'x', name: 'y', steps: [{ capture: 'a' }] }), {}), false)
  assert.throws(() => normalizeStepSpec({ id: 'c', surface: 'x', name: 'y', expectedLogEvents: 'x', steps: [{ capture: 'a' }] }), /expectedLogEvents/)
})

test('付费保护：步骤场景里点“生成”与续查真实任务都到不了供应商，夹具任务放行，收尾恢复原处理器', async () => {
  const electron = fakeElectronApp()
  const outcomes = []
  // 页面替身：click 模拟渲染层经 preload 调用 ai:generate / ai:continuePolling（真实界面点“生成”走的就是这两个通道）
  const page = {
    waitForTimeout: async () => undefined, mouse: { up: async () => undefined },
    getByRole: (_role, options) => ({ filter: () => ({ nth: () => ({ click: async () => {
      const invoke = (channel, request) => electron.handlers.get(channel)({}, request)
        .then((value) => outcomes.push([options.name, 'ok', value.data.status]), (error) => outcomes.push([options.name, 'rejected', error.message]))
      if (options.name === '生成') await invoke('ai:generate', { modelId: 'kie-seedance-2.0', prompt: '核对' })
      else if (options.name === '续查真实任务') await invoke('ai:continuePolling', { taskId: 'real-task-1', modelId: 'kie-seedance-2.0' })
      else await invoke('ai:continuePolling', { taskId: '__generation_background_0', modelId: 'kie-z-image' })
    } }) }) }),
  }
  const spec = normalizeStepSpec({ id: 'guard', surface: '测试', name: '测试-付费保护', steps: [
    { click: { role: 'button', name: '生成' } },
    { click: { role: 'button', name: '续查真实任务' } },
    { click: { role: 'button', name: '续查夹具任务' } },
  ] })
  await compileStepScene(spec, { closeTransientUi: async () => undefined, settlePage: async () => undefined }).setup(page, electron.app, {})
  assert.deepEqual(outcomes.map(([name, status]) => [name, status]), [['生成', 'rejected'], ['续查真实任务', 'rejected'], ['续查夹具任务', 'ok']])
  assert.match(outcomes[0][2], /禁止真实生成/)
  assert.deepEqual(electron.calls.map((call) => call.request.taskId), ['__generation_background_0'])
  for (const channel of PAID_GENERATION_CHANNELS) assert.equal(electron.handlers.get(channel), electron.production[channel])
  assert.equal(vm.runInContext('globalThis.__henjiReviewPaidGuard', electron.sandbox), undefined)
  // 步骤失败也要恢复
  const failing = normalizeStepSpec({ id: 'guard-fail', surface: '测试', name: '测试-付费保护失败', steps: [{ click: { role: 'button', name: '生成' } }] })
  const brokenPage = { ...page, getByRole: () => ({ filter: () => ({ nth: () => ({ click: async () => { throw new Error('点不到') } }) }) }) }
  await assert.rejects(compileStepScene(failing, { closeTransientUi: async () => undefined }).setup(brokenPage, electron.app, {}), /点不到/)
  for (const channel of PAID_GENERATION_CHANNELS) assert.equal(electron.handlers.get(channel), electron.production[channel])
  await assert.rejects(compileStepScene(failing, {}).setup(page, null, {}), /无法加付费保护/)
})

test('定位的 at：点在目标内指定点（相对左上角），非法值报错，缺省为中心', () => {
  const step = normalizeStep({ rightClick: { selector: '.react-flow__pane', at: { x: 40, y: 500 } } }, 's')
  assert.deepEqual(step.target.at, { x: 40, y: 500 })
  assert.deepEqual(pointInBox({ x: 10, y: 20, width: 300, height: 600 }, step.target), { x: 50, y: 520 })
  assert.deepEqual(pointInBox({ x: 10, y: 20, width: 300, height: 600 }, { selector: 'x' }), { x: 160, y: 320 })
  assert.throws(() => normalizeStep({ click: { selector: 'x', at: { x: -1, y: 0 } } }, 's'), /at 需要/)
  const drag = normalizeStep({ drag: { from: { selector: 'a', at: { x: 1, y: 2 } }, to: { dx: 5, dy: 0 } } }, 's')
  assert.deepEqual(drag.from.at, { x: 1, y: 2 })
})

test('drag.modifiers：拖动全程按住修饰键（画布框选按住 Control），非法键报错', () => {
  const drag = normalizeStep({ drag: { from: { selector: '.react-flow__pane', at: { x: 60, y: 140 } }, to: { dx: 300, dy: 120 }, modifiers: ['Control'] } }, 's')
  assert.deepEqual(drag.modifiers, ['Control'])
  assert.deepEqual(normalizeStep({ drag: { from: { selector: 'a' }, to: { dx: 1, dy: 0 } } }, 's').modifiers, [])
  assert.throws(() => normalizeStep({ drag: { from: { selector: 'a' }, to: { dx: 1, dy: 0 }, modifiers: ['Ctrl'] } }, 's'), /drag.modifiers/)
})

test('5.7 新动作：enter.updatePreview 写进 URL，logsWindow / mainWindow / seedHistory 参数校验', () => {
  const url = buildDevSurfaceUrl('file:///app/index.html?henjiDevThemePreset=paper',
    { surface: 'workspace.generation', updatePreview: 'failed' })
  assert.equal(new URL(url).searchParams.get('henjiDevUpdatePreview'), 'failed')
  assert.equal(new URL(buildDevSurfaceUrl(url, { surface: 'workspace.generation' })).searchParams.has('henjiDevUpdatePreview'), false)
  assert.deepEqual(normalizeStep({ enter: { surface: 'workspace.generation', updatePreview: 'downloading' } }, 't').updatePreview, 'downloading')
  assert.throws(() => normalizeStep({ enter: { workspace: 'generation', updatePreview: 'available' } }, 't'), /updatePreview/)
  assert.throws(() => normalizeStep({ enter: { surface: 'workspace.generation', updatePreview: 'install' } }, 't'), /updatePreview/)
  assert.equal(normalizeStep({ logsWindow: {} }, 't').action, 'logsWindow')
  assert.equal(normalizeStep({ mainWindow: {} }, 't').action, 'mainWindow')
  const seed = normalizeStep({ seedHistory: { rows: [{ id: 'img', type: 'image' }, { id: 'bad', type: 'image', status: 'error' }] } }, 't')
  assert.deepEqual(seed.rows.map((row) => [row.file, row.status]), [['image', 'success'], ['none', 'error']])
  assert.throws(() => normalizeStep({ seedHistory: { rows: [] } }, 't'), /非空/)
  assert.throws(() => normalizeStep({ seedHistory: { rows: [{ id: 'x', type: 'pdf' }] } }, 't'), /type/)
  assert.throws(() => normalizeStep({ seedHistory: { rows: [{ id: 'x', type: 'image', file: 'web' }] } }, 't'), /file/)
})
