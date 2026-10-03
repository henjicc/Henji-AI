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

const ROOT = path.resolve(__dirname, '..', '..')

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
  await assert.rejects(scene.setup(page, null, ctx), /1\/3 个变体失败：bad：截图失败/)
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
