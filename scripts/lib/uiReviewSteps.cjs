/**
 * 界面核对步骤描述（skill henji-ui-surface references/review.md）：
 * 用一份 JSON / cjs 描述“进入界面 → 动作 → 等待稳定 → 截图（+自动指标）”，编译成与 ui:tour /
 * check:ui-visual 同一套的场景对象（id / surface / name / setup），复用正式启动器、窗口尺寸、
 * 正式截屏、运行时证据、多预设与多尺寸，不另起一条 Electron 启动链。
 *
 * 文件格式（动作与定位的完整说明见 skill 参考文件 references/review.md 第 6 节；样例在 scripts/ui-review/）：
 * {
 *   "id": "review-generation-seedance-kie",      // [a-z0-9-]
 *   "surface": "生成", "name": "核对-…",
 *   "checklist": ["G07.1"],                      // 可选：对应 5.1 清单行，只进报告
 *   "writesUserData": false,                     // 写业务数据（如画布夹具）时必须为 true
 *   "launchArgs": [], "launchEnv": {},           // 只在本次只选中这一个场景时生效（与现有场景一致）
 *   "prepare": [ ...步骤 ],                       // 可选：变体开始前执行一次
 *   "variants": [...] | { "source": "generation-models", "include": [], "exclude": [], "limit": 0 },
 *   "steps": [ ...步骤 ]                          // 每个变体执行一次；字符串里的 {{字段}} 替换为变体字段
 * }
 */
const fs = require('node:fs')
const { createCanvasDocument, writeCanvasDocument } = require('./canvasDocumentFixture.cjs')
const os = require('node:os')
const path = require('node:path')
const { analyzeLayoutMetrics, collectLayoutMeasurements } = require('./uiReviewMetrics.cjs')
const { normalizeSeedAssistant, seedAssistantFixture } = require('./uiReviewAssistantFixture.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { createWaveFixture, normalizeSeedHistory, seedHistoryFixture } = require('./uiReviewHistoryFixture.cjs')
const { normalizeSeedAsset, seedAssetFixture } = require('./uiReviewAssetFixture.cjs')
const { normalizeReleaseIpc, normalizeStubIpc, releaseIpc, restoreIpcStubs, stubIpc } = require('./uiReviewIpcStub.cjs')
const { normalizeSeedSettings, seedSettingsFixture } = require('./uiReviewSettingsFixture.cjs')
const { normalizeSeedAudioEdit, seedAudioEditFixture } = require('./uiReviewAudioEditFixture.cjs')
const { normalizeSeedVideoEdit, seedVideoEditFixture } = require('./uiReviewVideoEditFixture.cjs')
const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const WORKSPACES = Object.freeze(['generation', 'canvas', 'toolbox', 'assets'])
const TARGET_KEYS = Object.freeze(['role', 'name', 'exact', 'text', 'label', 'placeholder', 'selector', 'hasText',
  'within', 'nth', 'closest', 'commonAncestorWith', 'includeHidden', 'at'])
const DRAG_MODIFIER_KEYS = Object.freeze(['Control', 'Shift', 'Alt', 'Meta'])
/** 与 src/core/development/developmentLaunchContract.ts 的 DEVELOPMENT_UPDATE_PREVIEW_STATES 一致 */
const UPDATE_PREVIEW_STATES = Object.freeze(['available', 'downloading', 'failed'])
const OVERLAY_SELECTOR = '[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible, '
  + '[data-panel-scroll-region]:visible, [data-dropdown-portal="true"]:visible'

/**
 * 动作名 → 规范化函数。每个步骤写成 `{ "动作": 参数, "optional"?: true, "timeout"?: 毫秒, "ifPresent"?: 定位 }`：
 * optional 失败时记为跳过；ifPresent 指向的元素此刻不可见时整步跳过（例如只在 960 下出现的“更多”）。
 */
const STEP_ACTIONS = Object.freeze({
  enter: (value) => {
    if (typeof value === 'string') value = { workspace: value }
    if (!value || typeof value !== 'object') throw new Error('enter 需要工作区名或 { workspace } / { surface, media }')
    if (value.workspace && !WORKSPACES.includes(value.workspace)) {
      throw new Error(`enter.workspace 仅支持 ${WORKSPACES.join('、')}`)
    }
    if (value.surface && !/^(workspace|tool|settings|overlay|dev)\.[a-z0-9_.-]+$/.test(value.surface)) {
      throw new Error(`enter.surface 不是已登记格式的 Surface ID：${value.surface}`)
    }
    if (!value.workspace && !value.surface) throw new Error('enter 需要 workspace 或 surface')
    // updatePreview：随 surface 一起重载，直接打开更新提示弹窗的预览状态（--dev-update-preview 同一条入口）
    if (value.updatePreview !== undefined && (!value.surface || !UPDATE_PREVIEW_STATES.includes(value.updatePreview))) {
      throw new Error(`enter.updatePreview 需要同时给 surface，取值 ${UPDATE_PREVIEW_STATES.join('、')}`)
    }
    return { workspace: value.workspace ?? null, surface: value.surface ?? null, media: value.media ?? null,
      ...(value.updatePreview ? { updatePreview: value.updatePreview } : {}) }
  },
  // 打开独立日志窗口，之后的步骤都在日志窗口里执行与截图，直到 mainWindow（任务 5.7）
  logsWindow: () => ({}),
  mainWindow: () => ({}),
  // 生成记录夹具（媒体查看器、结果菜单、通知提示用；需 writesUserData: true），见 uiReviewHistoryFixture.cjs
  seedHistory: (value) => normalizeSeedHistory(value),
  // 口播剪辑夹具工程（临时 WAV + 固定逐字稿，不走语音识别；需 writesUserData: true），见 uiReviewAudioEditFixture.cjs
  seedAudioEdit: (value) => normalizeSeedAudioEdit(value),
  // 剪辑夹具工程（临时 MP4 + 两序列工程文件，主进程“打开”对话框直接返回它；需 writesUserData: true），见 uiReviewVideoEditFixture.cjs
  seedVideoEdit: (value) => normalizeSeedVideoEdit(value),
  // overflow：目标在窄窗口下可能被收进“更多”菜单（收起项不挂载）。找不到可见目标时先点开这个入口，再点菜单里的同名项。
  click: (value) => {
    const { overflow, ...rest } = value && typeof value === 'object' ? value : {}
    return { target: normalizeTarget(rest.target ?? rest), button: rest.button ?? 'left', overflow: overflow ? normalizeTarget(overflow) : null }
  },
  doubleClick: (value) => ({ target: normalizeTarget(value?.target ?? value) }),
  rightClick: (value) => ({ target: normalizeTarget(value?.target ?? value) }),
  hover: (value) => ({ target: normalizeTarget(value?.target ?? value) }),
  focus: (value) => ({ target: normalizeTarget(value?.target ?? value), keyboard: value?.keyboard !== false }),
  press: (value) => {
    const key = typeof value === 'string' ? value : value?.key
    if (!key) throw new Error('press 需要按键名')
    return { key, target: value?.target ? normalizeTarget(value.target) : null }
  },
  fill: (value) => {
    if (typeof value?.text !== 'string') throw new Error('fill 需要 text')
    return { target: normalizeTarget(value.target), text: value.text }
  },
  open: (value) => ({
    trigger: normalizeTarget(value?.trigger ?? value),
    expect: value?.expect ? normalizeTarget(value.expect) : null,
  }),
  drag: (value) => {
    if (!value?.from) throw new Error('drag 需要 from')
    const to = value.to && (value.to.dx !== undefined || value.to.dy !== undefined)
      ? { dx: Number(value.to.dx ?? 0), dy: Number(value.to.dy ?? 0) }
      : normalizeTarget(value.to)
    // modifiers：拖动全程按住的修饰键（如画布框选要按住 Control；空白处直接拖是平移）
    const modifiers = value.modifiers ?? []
    if (!Array.isArray(modifiers) || modifiers.some((key) => !DRAG_MODIFIER_KEYS.includes(key))) {
      throw new Error(`drag.modifiers 只能是 ${DRAG_MODIFIER_KEYS.join('、')} 的数组`)
    }
    return { from: normalizeTarget(value.from), to, steps: positiveInteger(value.steps ?? 8, 'drag.steps'),
      release: value.release !== false, modifiers }
  },
  release: () => ({}),
  // 系统文件拖入（任务 5.8）：在目标上派发带文件的 dragenter / dragover（drop: true 时再派发 drop），
  // 截“拖入素材悬停”这类状态。文件路径相对仓库根目录；只构造浏览器 File，不经过系统拖放。
  dropFiles: (value) => {
    if (!Array.isArray(value?.files) || value.files.length === 0) throw new Error('dropFiles 需要 files 数组')
    // leave: true 只派发 dragleave，结束悬停态（截完图要恢复，否则后续步骤一直处在拖入中）
    if (value.drop && value.leave) throw new Error('dropFiles 的 drop 与 leave 不能同时为 true')
    return { target: normalizeTarget(value.target), files: value.files.map(String), drop: value.drop === true, leave: value.leave === true }
  },
  // 主进程 IPC 替身（任务 5.8）：hold 挂起 / reject 失败 / delay 延迟后照常执行，见 uiReviewIpcStub.cjs
  stubIpc: (value) => normalizeStubIpc(value),
  // 设置表夹具（音色库等只存在设置表里的数据；需 writesUserData: true），见 uiReviewSettingsFixture.cjs
  seedSettings: (value) => normalizeSeedSettings(value),
  // 资产库夹具（任务 5.8）：登记一张图片资产，`missing: true` 时删掉源文件（截预览加载失败；需 writesUserData: true）
  seedAsset: (value) => normalizeSeedAsset(value),
  releaseIpc: (value) => normalizeReleaseIpc(value),
  // 重载渲染层（任务 5.8）：启动时才读取的状态（如供应商密钥是否已配置）在 IPC 替身装好后重新读一次
  reload: () => ({}),
  // 系统保存/打开对话框不可点：在主进程把 dialog.showSaveDialog / showOpenDialog 换成直接返回。
  // 保存一律落到系统临时目录 henji-ui-review/<场景 id>/ 下（沿用请求里的默认文件名），打开返回仓库内文件；
  // 场景结束自动还原。用于导出、另存为等会弹系统对话框的流程（只写本机临时文件，不产生费用）。
  stubDialogs: (value) => {
    const open = value?.open ?? null
    if (open !== null && (!Array.isArray(open) || open.length === 0)) throw new Error('stubDialogs.open 需要非空文件数组')
    return { save: value?.save !== false, open: open ? open.map(String) : null }
  },
  // 文件选择框不可点：直接给（通常隐藏的）文件输入设值，走与用户选文件相同的 change 事件。路径相对仓库根目录。
  setFiles: (value) => {
    if (!Array.isArray(value?.files) || value.files.length === 0) throw new Error('setFiles 需要 files 数组')
    return { target: normalizeTarget({ includeHidden: true, ...value.target }), files: value.files.map(String) }
  },
  scroll: (value) => ({ target: normalizeTarget(value?.target ?? value), dx: Number(value?.dx ?? 0), dy: Number(value?.dy ?? 240) }),
  // 逐屏滚到底并逐屏截图（name-1、name-2……）：每次滚可见高度的八成，与窗口尺寸无关。
  // 写死“每次滚 360px”的步骤在 640 高的窗口里一屏装不下，中段漏截（重要记录 020）。
  scrollCapture: (value) => {
    if (!value?.name || !/^[a-z0-9-]+$/.test(value.name)) throw new Error(`scrollCapture.name 只能是小写字母、数字与连字符：${value?.name}`)
    return { target: normalizeTarget(value.target), name: value.name, max: positiveInteger(value.max ?? 80, 'scrollCapture.max') }
  },
  waitFor: (value) => ({ target: normalizeTarget(value?.target ?? value), state: value?.state ?? 'visible' }),
  wait: (value) => ({ ms: positiveInteger(typeof value === 'number' ? value : value?.ms, 'wait') }),
  waitStable: (value) => ({ target: value?.target ? normalizeTarget(value.target) : null }),
  escape: () => ({}),
  selectModel: (value) => {
    if (!value?.modelId || !value?.providerId) throw new Error('selectModel 需要 modelId 与 providerId')
    return { modelId: String(value.modelId), providerId: String(value.providerId), search: value.search ?? null }
  },
  // nodes 里的 "{{media:image}}" / "{{media:video}}" / "{{media:audio}}" 换成仓库夹具媒体的 data URL（任务 5.8），
  // 用来摆出图片 / 视频 / 音频结果节点的“有结果、可播放”状态
  seedCanvas: (value) => {
    if (!Array.isArray(value?.nodes) || value.nodes.length === 0) throw new Error('seedCanvas 需要 nodes')
    return { nodes: value.nodes, edges: value.edges ?? [], viewport: value.viewport ?? { x: 120, y: 80, zoom: 0.9 } }
  },
  // 已命名的空画布（3.4 起“新建画布”直接打开草稿、空草稿离开即删）：经测试夹具的正式文档接口建在作品目录“画布/”，
  // 之后 reload 或重新进入画布页即可在列表看到
  seedCanvasDocuments: (value) => {
    if (!Array.isArray(value?.names) || value.names.length === 0) throw new Error('seedCanvasDocuments 需要 names')
    return { names: value.names.map(String) }
  },
  // 助手夹具：本机流式模型替身 + 隔离模型配置（uiReviewAssistantFixture.cjs）；要在打开助手侧栏之前执行，
  // 侧栏挂载时才读取模型列表。releaseAssistant 放行 hold 暂停中的那一轮回复。
  seedAssistant: (value) => normalizeSeedAssistant(value),
  releaseAssistant: () => ({}),
  // 尺寸扫描（重要记录 020）：拖动停靠面板之间的每条分隔条，把两侧面板逐档压到最小，再逐档缩小窗口；
  // 每一档只跑 DOM 规则（遮挡、裁切、截断、折行……），出现新问题的那一档才截图（窗口档只记规则），扫完复原。
  sweepLayout: (value) => {
    const spec = value && typeof value === 'object' ? value : {}
    const name = spec.name ?? 'sweep'
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`sweepLayout.name 只能是小写字母、数字与连字符：${name}`)
    const windows = (spec.windows ?? []).map((size) => {
      const match = /^(\d+)x(\d+)$/.exec(String(size))
      if (!match) throw new Error(`sweepLayout.windows 需要“宽x高”：${size}`)
      return { width: Number(match[1]), height: Number(match[2]) }
    })
    return { name, within: spec.within ? normalizeTarget(spec.within) : null, step: positiveInteger(spec.step ?? 80, 'sweepLayout.step'),
      maxSteps: positiveInteger(spec.maxSteps ?? 8, 'sweepLayout.maxSteps'), sashes: spec.sashes !== false, windows }
  },
  capture: (value) => {
    const spec = typeof value === 'string' ? { name: value } : value
    if (!spec?.name || !/^[a-z0-9-]+$/.test(spec.name)) throw new Error(`capture.name 只能是小写字母、数字与连字符：${spec?.name}`)
    return { name: spec.name, metrics: spec.metrics ? normalizeMetricsSpec(spec.metrics) : null }
  },
  metrics: (value) => {
    if (!value?.name || !/^[a-z0-9-]+$/.test(value.name)) throw new Error('metrics 需要 name')
    return { name: value.name, metrics: normalizeMetricsSpec(value) }
  },
})

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} 必须是正整数`)
  return number
}

/** "/^模式/i" 形式的字符串解析为正则，其余原样。 */
function parsePattern(value) {
  if (typeof value !== 'string') return value
  const match = /^\/(.+)\/([dgimsuy]*)$/.exec(value)
  return match ? new RegExp(match[1], match[2]) : value
}

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('定位需要对象，如 { "role": "button", "name": "生成" }')
  const unknown = Object.keys(raw).filter((key) => !TARGET_KEYS.includes(key))
  if (unknown.length) throw new Error(`未知定位字段：${unknown.join('、')}`)
  if (!raw.role && !raw.text && !raw.label && !raw.placeholder && !raw.selector) {
    throw new Error('定位至少需要 role / text / label / placeholder / selector 之一（优先 role + name）')
  }
  if (raw.nth !== undefined && raw.nth !== 'last' && !(Number.isInteger(raw.nth) && raw.nth >= 0)) {
    throw new Error('nth 只能是非负整数或 "last"')
  }
  // at：点击/悬停/拖动落在目标内的哪个点（相对目标左上角的 CSS 像素），默认目标中心。
  // 画布空白处这类大目标的中心常被节点或连线占住，需要指定一个确定为空的点。
  if (raw.at !== undefined && !(raw.at && Number.isFinite(raw.at.x) && Number.isFinite(raw.at.y) && raw.at.x >= 0 && raw.at.y >= 0)) {
    throw new Error('at 需要 { "x": 非负像素, "y": 非负像素 }（相对目标左上角）')
  }
  return {
    ...raw,
    within: raw.within ? normalizeTarget(raw.within) : undefined,
    commonAncestorWith: raw.commonAncestorWith ? normalizeTarget(raw.commonAncestorWith) : undefined,
  }
}

/** 指标目标：`{ target: 定位, maxRows }`，或直接把定位字段写在同一层（maxRows 默认 1，null 表示不判行数）。 */
function normalizeMetricsSpec(raw) {
  const { maxRows, name: _name, target, ...inlineTarget } = raw
  if (maxRows !== undefined && maxRows !== null && !(Number.isInteger(maxRows) && maxRows >= 1)) {
    throw new Error('metrics.maxRows 只能是正整数或 null')
  }
  return {
    target: normalizeTarget(target ?? inlineTarget),
    maxRows: maxRows === undefined ? 1 : maxRows,
  }
}

function normalizeStep(raw, where) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}：步骤必须是对象`)
  const { optional = false, timeout, ifPresent, ...rest } = raw
  const actionKeys = Object.keys(rest)
  if (actionKeys.length !== 1) throw new Error(`${where}：每个步骤只能有一个动作，收到 ${actionKeys.join('、') || '无'}`)
  const [action] = actionKeys
  const normalize = STEP_ACTIONS[action]
  if (!normalize) throw new Error(`${where}：未知动作 ${action}；可用 ${Object.keys(STEP_ACTIONS).join('、')}`)
  try {
    return { action, optional: optional === true, timeout: timeout === undefined ? 8000 : positiveInteger(timeout, 'timeout'),
      ifPresent: ifPresent ? normalizeTarget(ifPresent) : null, ...normalize(rest[action]) }
  } catch (error) {
    throw new Error(`${where}（${action}）：${error.message}`)
  }
}

function normalizeVariants(raw) {
  if (raw === undefined || raw === null) return null
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw new Error('variants 不能为空数组')
    return { list: raw.map((variant, index) => ({ ...variant, id: variantId(variant, index) })) }
  }
  if (typeof raw === 'object' && typeof raw.source === 'string') {
    if (!VARIANT_SOURCES[raw.source]) throw new Error(`未知变体来源 ${raw.source}；可用 ${Object.keys(VARIANT_SOURCES).join('、')}`)
    return { source: raw.source, include: raw.include ?? [], exclude: raw.exclude ?? [], limit: raw.limit ?? 0 }
  }
  throw new Error('variants 必须是数组或 { source }')
}

function normalizeStepSpec(raw, sourceFile = '<内联>') {
  if (!raw || typeof raw !== 'object') throw new Error(`${sourceFile}：步骤描述必须是对象`)
  if (!/^[a-z0-9-]+$/.test(raw.id ?? '')) throw new Error(`${sourceFile}：id 只能是小写字母、数字与连字符`)
  if (!raw.surface || !raw.name) throw new Error(`${sourceFile}：需要 surface 与 name`)
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error(`${sourceFile}：steps 不能为空`)
  return {
    id: raw.id,
    surface: raw.surface,
    scrollCoverage: raw.scrollCoverage || null,
    name: raw.name,
    checklist: raw.checklist ?? [],
    sourceFile,
    writesUserData: raw.writesUserData === true,
    // 场景有意制造的失败日志事件（如助手替身返回 HTTP 500）：记入证据，不判失败（与正式场景同名字段）
    expectedLogEvents: normalizeExpectedLogEvents(raw.expectedLogEvents, sourceFile),
    expectedBrowserErrors: normalizeExpectedBrowserErrors(raw.expectedBrowserErrors, sourceFile),
    launchArgs: raw.launchArgs ?? [],
    launchEnv: raw.launchEnv ?? {},
    prepare: (raw.prepare ?? []).map((step, index) => normalizeStep(step, `${sourceFile} prepare[${index}]`)),
    // steps 里可能含 {{变体字段}}，模板替换后再逐个规范化；这里先按原样校验一遍结构
    rawSteps: raw.steps,
    steps: raw.steps.map((step, index) => normalizeStep(expandTemplate(step, TEMPLATE_PROBE), `${sourceFile} steps[${index}]`)),
    variants: normalizeVariants(raw.variants),
  }
}

function normalizeExpectedLogEvents(value, sourceFile) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(item))) {
    throw new Error(`${sourceFile}：expectedLogEvents 必须是日志事件名数组`)
  }
  return value
}

/** 场景有意制造的浏览器控制台错误（正则文本，如源文件丢失时的 404）：记入证据，不判失败 */
function normalizeExpectedBrowserErrors(value, sourceFile) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${sourceFile}：expectedBrowserErrors 必须是正则文本数组`)
  }
  for (const item of value) new RegExp(item)
  return value
}

/** 结构校验时用的占位变体：模板字段替换成可通过格式校验的值。 */
const TEMPLATE_PROBE = new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? 'probe' : undefined), has: () => true })

/** 深拷贝并把字符串里的 {{key}} 换成变体字段；缺字段直接报错，避免截到错模型。 */
function expandTemplate(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key) => {
      // {{size}} 不是变体字段：留到执行时按当前窗口档展开（fill）。结构校验的占位变体对任何字段都返回 probe，
      // 不能让它把 {{size}} 提前换掉
      if (key === 'size') return whole
      if (!(key in vars) || vars[key] === undefined) throw new Error(`模板字段 {{${key}}} 在变体里不存在`)
      return String(vars[key])
    })
  }
  if (Array.isArray(value)) return value.map((item) => expandTemplate(item, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandTemplate(item, vars)]))
  }
  return value
}

/** 截图后缀只能是 [a-z0-9-]：模型 ID 里的点、斜杠、大写一律折成连字符。 */
function sanitizeSuffix(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'
}

function variantId(variant, index) {
  if (variant.id) return sanitizeSuffix(variant.id)
  const parts = [variant.providerId, variant.modelId].filter(Boolean)
  return sanitizeSuffix(parts.length ? parts.join('-') : `variant-${index + 1}`)
}

function matchesAny(value, patterns) {
  return patterns.map(parsePattern).some((pattern) => (
    pattern instanceof RegExp ? pattern.test(value) : value.includes(String(pattern))
  ))
}

/** include 为空表示全选；exclude 优先；limit > 0 时截断。id 冲突时追加序号。 */
function filterVariants(list, { include = [], exclude = [], limit = 0 } = {}) {
  const keyOf = (variant) => [variant.id, variant.modelId, variant.providerId, variant.name].filter(Boolean).join(' ')
  const filtered = list
    .filter((variant) => include.length === 0 || matchesAny(keyOf(variant), include))
    .filter((variant) => !matchesAny(keyOf(variant), exclude))
  const seen = new Map()
  const unique = filtered.map((variant) => {
    const count = seen.get(variant.id) ?? 0
    seen.set(variant.id, count + 1)
    return count === 0 ? variant : { ...variant, id: `${variant.id}-${count + 1}` }
  })
  return limit > 0 ? unique.slice(0, limit) : unique
}

/** 运行时变体来源：都从真实界面读取，读到的就是用户能选到的。 */
const VARIANT_SOURCES = Object.freeze({
  'generation-models': async (page, context) => {
    await context.openGenerationModelPanel(page)
    const panel = page.locator('[data-model-selector-panel]:visible')
    const list = await panel.locator('[data-model-id][data-provider-id]').evaluateAll((items) => items.map((item) => ({
      modelId: item.getAttribute('data-model-id'),
      providerId: item.getAttribute('data-provider-id'),
      name: (item.innerText || '').split('\n')[0].trim(),
    })))
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden', timeout: 8000 })
    if (list.length === 0) throw new Error('模型选择面板没有列出任何模型')
    return list.map((variant, index) => ({ ...variant, id: variantId(variant, index) }))
  },
})

/** `enter.surface`：用开发导航参数重载渲染层（与 --dev-surface 同一条正式入口），保留主题预设等其余参数。 */
function buildDevSurfaceUrl(currentUrl, { surface, media, updatePreview }, root = ROOT) {
  const url = new URL(currentUrl)
  url.searchParams.set('henjiDevSurface', surface)
  if (media) url.searchParams.set('henjiDevMedia', path.isAbsolute(media) ? media : path.resolve(root, media))
  else url.searchParams.delete('henjiDevMedia')
  if (updatePreview) url.searchParams.set('henjiDevUpdatePreview', updatePreview)
  else url.searchParams.delete('henjiDevUpdatePreview')
  return url.toString()
}

async function leaveDevSurface(page, context) {
  const url = new URL(page.url())
  if (!url.searchParams.has('henjiDevSurface')) return
  for (const key of ['henjiDevSurface', 'henjiDevMedia', 'henjiDevUpdatePreview']) url.searchParams.delete(key)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
  await page.waitForFunction(() => document.documentElement.dataset.uiScale !== undefined, null, { timeout: 15000 })
  await context.settlePage(page)
}

/** 定位 → Playwright Locator。默认只取可见元素的第一个；commonAncestorWith / closest 取最深的匹配祖先。 */
async function releaseModifiers(page, runtime) {
  const keys = runtime.heldModifiers ?? []
  runtime.heldModifiers = []
  for (const key of keys.reverse()) await page.keyboard.up(key)
}

/** 定位上的 at（相对左上角像素）转成 Playwright 的 position 选项；没有 at 时点在中心。 */
function pointOption(target) {
  return target?.at ? { position: { x: target.at.x, y: target.at.y } } : {}
}

function pointInBox(box, target) {
  return target?.at
    ? { x: box.x + target.at.x, y: box.y + target.at.y }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function resolveTarget(page, target) {
  const base = target.within ? resolveTarget(page, target.within) : page
  const name = parsePattern(target.name)
  const options = name === undefined ? {} : { name, ...(target.exact ? { exact: true } : {}) }
  let locator
  if (target.role) locator = base.getByRole(target.role, options)
  else if (target.label) locator = base.getByLabel(parsePattern(target.label), target.exact ? { exact: true } : {})
  else if (target.placeholder) locator = base.getByPlaceholder(parsePattern(target.placeholder))
  else if (target.text) locator = base.getByText(parsePattern(target.text), target.exact ? { exact: true } : {})
  else locator = base.locator(target.selector)
  if (target.hasText) locator = locator.filter({ hasText: parsePattern(target.hasText) })
  if (!target.includeHidden) locator = locator.filter({ visible: true })
  locator = target.nth === 'last' ? locator.last() : locator.nth(target.nth ?? 0)
  if (target.closest) {
    // 文档顺序里祖先在前，含有该元素的最后一个匹配就是最近的祖先
    locator = page.locator(target.closest).filter({ has: locator }).last()
  }
  if (target.commonAncestorWith) {
    const other = resolveTarget(page, target.commonAncestorWith)
    locator = page.locator('*').filter({ has: locator }).filter({ has: other }).last()
  }
  return locator
}

/** 等待稳定：字体就绪、可见图片解码完、有限次动画与过渡结束，目标几何连续两次一致。 */
async function waitForStable(page, settlePage, { target = null, timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout
  await page.evaluate(() => document.fonts?.ready)
  let lastBox = null
  let lastReason = ''
  while (Date.now() < deadline) {
    lastReason = await page.evaluate(() => {
      const running = document.getAnimations().filter((animation) => {
        if (animation.playState !== 'running') return false
        const timing = animation.effect?.getComputedTiming?.()
        return timing && timing.iterations !== Infinity
      })
      if (running.length) return `动画进行中 ${running.length}`
      const pendingImages = [...document.images].filter((image) => {
        const rect = image.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && !image.complete
      })
      return pendingImages.length ? `图片加载中 ${pendingImages.length}` : ''
    })
    if (!lastReason && target) {
      const box = await target.boundingBox()
      const same = box && lastBox && ['x', 'y', 'width', 'height'].every((key) => Math.abs(box[key] - lastBox[key]) < 0.5)
      lastBox = box
      if (!same) lastReason = '目标几何仍在变化'
    }
    if (!lastReason) {
      await settlePage(page, 120)
      return
    }
    await page.waitForTimeout(80)
  }
  throw new Error(`等待界面稳定超时：${lastReason}`)
}

async function measureTarget(page, spec) {
  const locator = resolveTarget(page, spec.target)
  await locator.waitFor({ state: 'visible', timeout: 8000 })
  const raw = await locator.evaluate(collectLayoutMeasurements)
  return analyzeLayoutMetrics(raw, { maxRows: spec.maxRows })
}

const MEDIA_PLACEHOLDER_PATTERN = /\{\{media:(image|video|audio)\}\}/g
const MIME_BY_EXTENSION = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain' })

/** 夹具媒体的 data URL：图片取应用图标，视频取仓库 6KB 测试片，音频现生成一段低音量 WAV。 */
function canvasMediaDataUrls() {
  const read = (file) => fs.readFileSync(path.join(ROOT, file)).toString('base64')
  return {
    image: `data:image/png;base64,${read('resources/icons/icon.png')}`,
    video: `data:video/mp4;base64,${read('scripts/fixtures/plain_video.mp4')}`,
    audio: `data:audio/wav;base64,${Buffer.from(createWaveFixture()).toString('base64')}`,
  }
}

function expandMediaPlaceholders(value, media) {
  if (typeof value === 'string') return value.replace(MEDIA_PLACEHOLDER_PATTERN, (_match, kind) => media[kind])
  if (Array.isArray(value)) return value.map((item) => expandMediaPlaceholders(item, media))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandMediaPlaceholders(item, media)]))
  }
  return value
}

/**
 * 现生成的夹具文件（任务 5.8）：`@generated:video:<秒>` / `@generated:audio:<秒>` 用本机 FFmpeg 生成测试视频（测试图案 + 正弦音）或 WAV，
 * 放在系统临时目录并按时长缓存。仓库里只有 2 秒的视频夹具，“长视频”这类状态靠它截。
 * `@generated:image:<宽>x<高>` 生成大尺寸细节图（测试图案 + 噪点，JPEG），代替不进仓库的私有参考图（GPU 预算类验收）。
 */
function resolveFixtureFile(file) {
  const image = /^@generated:image:(\d+)x(\d+)$/.exec(file)
  if (image) {
    const [width, height] = [Number(image[1]), Number(image[2])]
    if (!(width >= 16 && height >= 16 && width <= 16384 && height <= 16384)) throw new Error('@generated:image 尺寸需在 16–16384')
    const output = path.join(os.tmpdir(), 'henji-ui-review', `generated-image-${width}x${height}.jpg`)
    if (!fs.existsSync(output)) {
      fs.mkdirSync(path.dirname(output), { recursive: true })
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      require('node:child_process').execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
        `testsrc2=size=${width}x${height}:rate=1`, '-vf', 'noise=alls=24:allf=t', '-frames:v', '1', '-q:v', '3', output],
      { windowsHide: true, timeout: 120000 })
    }
    return output
  }
  const generated = /^@generated:(video|audio):(\d+)$/.exec(file)
  if (!generated) return path.isAbsolute(file) ? file : path.resolve(ROOT, file)
  const [, kind, rawSeconds] = generated
  const seconds = Number(rawSeconds)
  if (!(seconds >= 1 && seconds <= 600)) throw new Error('@generated 时长需在 1–600 秒')
  const output = path.join(os.tmpdir(), 'henji-ui-review', `generated-${kind}-${seconds}s.${kind === 'video' ? 'mp4' : 'wav'}`)
  if (!fs.existsSync(output)) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    const { ffmpegPath } = require('./mediaBinaries.cjs')
    const args = kind === 'video'
      ? ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
        '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']
      : ['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=24000', '-t', String(seconds), '-af', 'volume=0.2']
    require('node:child_process').execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args, output], { windowsHide: true, timeout: 120000 })
  }
  return output
}

async function dispatchFileDrag(page, step) {
  const files = step.files.map((file) => {
    const absolute = path.isAbsolute(file) ? file : path.resolve(ROOT, file)
    return { name: path.basename(absolute), type: MIME_BY_EXTENSION[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream',
      bytes: [...fs.readFileSync(absolute)] }
  })
  const dataTransfer = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer()
    for (const item of items) transfer.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: item.type }))
    return transfer
  }, files)
  const target = resolveTarget(page, step.target)
  if (step.leave) {
    await target.dispatchEvent('dragleave', { dataTransfer })
  } else {
    await target.dispatchEvent('dragenter', { dataTransfer })
    await target.dispatchEvent('dragover', { dataTransfer })
    if (step.drop) await target.dispatchEvent('drop', { dataTransfer })
  }
  await dataTransfer.dispose()
}

async function seedCanvasFixture(page, context, { nodes: rawNodes, edges, viewport }) {
  const nodes = JSON.stringify(rawNodes).includes('{{media:') ? expandMediaPlaceholders(rawNodes, canvasMediaDataUrls()) : rawNodes
  await context.setupCanvas(page)
  if (await page.locator('.react-flow').count()) {
    await page.getByRole('button', { name: /返回画布列表|Back to Canvases/ }).click()
    await context.settlePage(page)
  }
  const projectId = context.canvasFixtureProjectId
  const card = page.locator(`[data-project-id="${projectId}"]:visible`)
  // 巡检专用画布在启动时建好；前面的场景（工程列表多选删除）可能把它移到了回收站：按同一个 ID 重建
  if (!(await card.isVisible().catch(() => false)) && context.canvasFixtureProjectName) {
    await card.waitFor({ state: 'visible', timeout: 3000 }).catch(async () => {
      await createCanvasDocument(page, { id: projectId, name: context.canvasFixtureProjectName, viewport: viewport ?? { x: 120, y: 80, zoom: 0.85 } })
      // 列表不一定订阅了索引变化：重载界面再回到画布列表，按新索引重新读
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
      await context.setupCanvas(page)
      await context.settlePage(page)
    })
  }
  await card.waitFor({ state: 'visible', timeout: 12000 })
  await writeCanvasDocument(page, projectId, { nodes, edges, viewport })
  await context.reopenCanvasProjectFromStorage(page, projectId)
  await page.locator('[data-application-observation-region="canvas.viewport_observer"]:visible')
    .waitFor({ state: 'visible', timeout: 12000 })
}

async function runStep(page, step, runtime) {
  const { context, ctx, prefix, variant } = runtime
  const timeout = step.timeout
  switch (step.action) {
    case 'enter':
      if (step.workspace) {
        await context.openWorkspace(page, step.workspace)
      } else {
        runtime.devSurfaceEntered = true
        await page.goto(buildDevSurfaceUrl(page.url(), step), { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
        await page.locator(`[data-application-surface-id="${step.surface}"]:visible`).first()
          .waitFor({ state: 'visible', timeout: 15000 })
        // 重载后窗口缩放会先回到默认，再由界面缩放 hook 异步写回；等它写回并稳定，避免把过渡态当成尺寸漂移。
        await page.waitForFunction(() => document.documentElement.dataset.uiScale !== undefined, null, { timeout: 15000 })
        await context.settlePage(page)
      }
      return
    case 'click':
      if (step.overflow && !(await resolveTarget(page, step.target).count())) await resolveTarget(page, step.overflow).click({ timeout })
      await resolveTarget(page, step.target).click({ timeout, button: step.button, ...pointOption(step.target) })
      return
    case 'doubleClick':
      await resolveTarget(page, step.target).dblclick({ timeout, ...pointOption(step.target) })
      return
    case 'rightClick':
      await resolveTarget(page, step.target).click({ timeout, button: 'right', ...pointOption(step.target) })
      return
    case 'hover':
      await resolveTarget(page, step.target).hover({ timeout, ...pointOption(step.target) })
      return
    case 'focus':
      // 先产生一次键盘交互，focus() 才会命中 :focus-visible（键盘聚焦样式）
      if (step.keyboard) await page.keyboard.press('Shift')
      await resolveTarget(page, step.target).focus({ timeout })
      return
    case 'press':
      if (step.target) await resolveTarget(page, step.target).press(step.key, { timeout })
      else await page.keyboard.press(step.key)
      return
    case 'fill': {
      // {{size}}：当前窗口档（如 960x640）。两档尺寸在同一实例里连跑，存盘起名的场景靠它避开上一档留下的同名文件
      const size = ctx.requestedWindowSize ? `${ctx.requestedWindowSize.width}x${ctx.requestedWindowSize.height}` : ''
      await resolveTarget(page, step.target).fill(step.text.split('{{size}}').join(size), { timeout })
      return
    }
    case 'open': {
      await resolveTarget(page, step.trigger).click({ timeout })
      const overlay = step.expect ? resolveTarget(page, step.expect) : page.locator(OVERLAY_SELECTOR).last()
      await overlay.waitFor({ state: 'visible', timeout })
      return
    }
    case 'drag': {
      const fromBox = await resolveTarget(page, step.from).boundingBox({ timeout })
      if (!fromBox) throw new Error('拖动起点不可见')
      const start = pointInBox(fromBox, step.from)
      let end
      if (step.to.dx !== undefined) end = { x: start.x + step.to.dx, y: start.y + step.to.dy }
      else {
        const toBox = await resolveTarget(page, step.to).boundingBox({ timeout })
        if (!toBox) throw new Error('拖动终点不可见')
        end = pointInBox(toBox, step.to)
      }
      await page.mouse.move(start.x, start.y)
      for (const key of step.modifiers) await page.keyboard.down(key)
      runtime.heldModifiers = [...step.modifiers]
      await page.mouse.down()
      runtime.mouseDown = true
      await page.mouse.move(end.x, end.y, { steps: step.steps })
      if (step.release) {
        await page.mouse.up()
        runtime.mouseDown = false
        await releaseModifiers(page, runtime)
      }
      return
    }
    case 'release':
      await page.mouse.up()
      runtime.mouseDown = false
      await releaseModifiers(page, runtime)
      return
    case 'seedSettings':
      runtime.audioEditFixtures.push(await seedSettingsFixture(page, context, step))
      return
    case 'seedAsset':
      runtime.audioEditFixtures.push(await seedAssetFixture(page, step))
      return
    case 'dropFiles':
      await dispatchFileDrag(page, step)
      return
    case 'reload': {
      const url = new URL(page.url())
      for (const key of ['henjiDevSurface', 'henjiDevMedia', 'henjiDevUpdatePreview']) url.searchParams.delete(key)
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
      await context.settlePage(page)
      return
    }
    case 'stubIpc':
      await stubIpc(runtime.app, step)
      runtime.ipcStubbed = true
      console.log(`  IPC 替身：${step.channel} → ${step.mode}`)
      return
    case 'releaseIpc': {
      const count = await releaseIpc(runtime.app, step)
      console.log(`  IPC 放行：${step.channel}（${count} 个挂起调用 → ${step.release}）`)
      return
    }
    case 'stubDialogs': {
      const outputDir = path.join(os.tmpdir(), 'henji-ui-review', runtime.sceneId || 'scene')
      fs.mkdirSync(outputDir, { recursive: true })
      // `@tmp:<名字>`：系统临时目录 henji-ui-review/<场景 id>/<名字>（选目录类对话框，如数据目录迁移的目标文件夹）
      const openPaths = step.open ? step.open.map((file) => {
        const temp = /^@tmp:([\w.-]+)$/.exec(file)
        if (temp) {
          // 每次都是空目录：上一次运行留下的内容会让“选目录”走到别的分支（如数据目录迁移的“已有数据”冲突）
          const directory = path.join(outputDir, temp[1])
          fs.rmSync(directory, { recursive: true, force: true })
          fs.mkdirSync(directory, { recursive: true })
          return directory
        }
        return path.isAbsolute(file) ? file : path.resolve(ROOT, file)
      }) : null
      await runtime.app.evaluate(({ dialog }, values) => {
        const store = globalThis.__henjiUiReviewDialogs ?? (globalThis.__henjiUiReviewDialogs = {
          save: dialog.showSaveDialog, open: dialog.showOpenDialog,
        })
        dialog.showSaveDialog = values.save
          ? async (...args) => {
            const options = args.find((arg) => arg && typeof arg === 'object' && ('defaultPath' in arg || 'filters' in arg)) ?? {}
            const name = String(options.defaultPath || 'output').split(/[\\/]/).pop() || 'output'
            return { canceled: false, filePath: `${values.outputDir}${values.sep}${name}` }
          }
          : store.save
        dialog.showOpenDialog = values.openPaths
          ? async () => ({ canceled: false, filePaths: values.openPaths })
          : store.open
      }, { save: step.save, openPaths, outputDir, sep: path.sep })
      runtime.dialogsStubbed = true
      console.log(`  系统对话框已替换：保存到 ${outputDir}`)
      return
    }
    case 'seedVideoEdit': {
      runtime.audioEditFixtures.push(await seedVideoEditFixture(runtime, step))
      return
    }
    case 'seedAudioEdit': {
      const fixture = await seedAudioEditFixture(page, step)
      runtime.audioEditFixtures.push(fixture)
      return
    }
    case 'setFiles':
      await resolveTarget(page, step.target).setInputFiles(step.files.map(resolveFixtureFile), { timeout })
      return
    case 'scroll': {
      const box = await resolveTarget(page, step.target).boundingBox({ timeout })
      if (!box) throw new Error('滚动目标不可见')
      const point = pointInBox(box, step.target)
      await page.mouse.move(point.x, point.y)
      await page.mouse.wheel(step.dx, step.dy)
      return
    }
    case 'scrollCapture': {
      const scroller = resolveTarget(page, step.target)
      for (let index = 1; ; index += 1) {
        // 直接改 scrollTop：滚轮落点下常有内层列表，会把滚轮吃掉
        const moved = await scroller.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          const visible = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0))
          const before = node.scrollTop
          if (before + node.clientHeight >= node.scrollHeight - 1) return false
          node.scrollTop = before + Math.max(120, Math.floor(Math.min(visible, node.clientHeight) * 0.8))
          return node.scrollTop !== before
        }, undefined, { timeout })
        if (!moved) return
        if (index > step.max) throw new Error(`scrollCapture 截了 ${step.max} 屏仍未滚到底：${step.name}`)
        await waitForStable(page, context.settlePage, { timeout })
        const suffix = prefix ? `${prefix}-${step.name}-${index}` : `${step.name}-${index}`
        await ctx.capture(suffix, runtime.activePage ? { page: runtime.activePage } : undefined)
      }
    }
    case 'waitFor':
      await resolveTarget(page, step.target).waitFor({ state: step.state, timeout })
      return
    case 'wait':
      await page.waitForTimeout(step.ms)
      return
    case 'waitStable':
      await waitForStable(page, context.settlePage, {
        target: step.target ? resolveTarget(page, step.target) : null, timeout,
      })
      return
    case 'escape':
      await context.closeTransientUi(page)
      return
    case 'selectModel': {
      const search = await context.openGenerationModelPanel(page)
      if (step.search) await search.fill(step.search)
      const panel = page.locator('[data-model-selector-panel]:visible')
      const item = panel.locator(`[data-model-id="${step.modelId}"][data-provider-id="${step.providerId}"]`).first()
      // 模型列表是虚拟网格，只挂载可见的几行：目标没挂载时逐屏向下滚动列表，直到它出现或滚到底。
      // 列表打开时会滚到当前选中的模型（可能排在目标后面），所以先回到顶部再往下找
      if (!(await item.count())) {
        await panel.evaluate((root) => {
          const scope = root.querySelector('[data-special-panel-body]') ?? root
          for (const node of [scope, ...scope.querySelectorAll('*')]) {
            if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollTop > 0) node.scrollTop = 0
          }
        })
        await page.waitForTimeout(120)
      }
      for (let screen = 0; screen < 80 && !(await item.count()); screen += 1) {
        const moved = await panel.evaluate((root) => {
          // 特殊面板的左栏在矮窗口里也会滚：只在正文里找。矮窗口下正文与虚拟列表可能各有一层滚动，
          // 外层滚到底时里层还有没挂载的行：从已挂载的格子往上，先滚最近的一层，滚不动再退到外层
          const scope = root.querySelector('[data-special-panel-body]') ?? root
          const scrollable = (node) => node.scrollHeight > node.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)
          const chain = []
          for (let node = scope.querySelector('[data-model-id]')?.parentElement; node && root.contains(node); node = node.parentElement) {
            if (scrollable(node)) chain.push(node)
          }
          if (!chain.length) chain.push(...[scope, ...scope.querySelectorAll('*')].filter(scrollable))
          for (const scroller of chain) {
            const before = scroller.scrollTop
            scroller.scrollTop += Math.max(1, scroller.clientHeight * 0.8)
            if (scroller.scrollTop !== before) return true
          }
          return false
        })
        await page.waitForTimeout(60)
        if (!moved && !(await item.count())) break
      }
      if (!(await item.count())) {
        // 滚到底仍没挂载：报出列表停在哪里，不让 click 干等超时
        const state = await panel.evaluate((root) => {
          const cells = [...root.querySelectorAll('[data-model-id]')]
          const scrollers = [...root.querySelectorAll('*')].filter((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2)
            .map((node) => `${node.className.toString().slice(0, 40) || node.tagName}:${Math.round(node.scrollTop)}/${node.scrollHeight - node.clientHeight}`)
          const filters = [...root.querySelectorAll('[aria-pressed="true"], [aria-current], [aria-checked="true"]')].map((node) => (node.textContent || '').trim().slice(0, 12)).filter(Boolean)
          const search = root.querySelector('input')?.value || ''
          return { mounted: cells.length, last: cells.at(-1)?.getAttribute('data-model-id') || '', scrollers, filters, search }
        })
        throw new Error(`selectModel 滚到底仍没找到 ${step.providerId}/${step.modelId}：已挂载 ${state.mounted} 个格子（最后一个 ${state.last}），滚动层 ${state.scrollers.join('，') || '无'}，当前筛选 ${state.filters.join('、') || '无'}，搜索「${state.search}」`)
      }
      // 挂载了但可能在可视区外：直接把列表滚到它居中。Playwright 的 scrollIntoViewIfNeeded 一滚，虚拟网格就换掉
      // 这一行的节点，它会一直等元素稳定直到超时（偶发：kie-kling-3-0）
      await panel.evaluate((root, selector) => {
        const target = root.querySelector(selector)
        // 离目标最近的滚动层（虚拟列表自己的滚动区），不是最外层
        let scroller = target?.parentElement
        while (scroller && root.contains(scroller) && !(scroller.scrollHeight > scroller.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
        if (!target || !scroller || !root.contains(scroller)) return
        const box = target.getBoundingClientRect()
        const view = scroller.getBoundingClientRect()
        if (box.top >= view.top && box.bottom <= view.bottom) return
        scroller.scrollTop += box.top - view.top - (view.height - box.height) / 2
      }, `[data-model-id="${step.modelId}"][data-provider-id="${step.providerId}"]`)
      await page.waitForTimeout(80)
      await item.click({ timeout })
      await panel.waitFor({ state: 'hidden', timeout })
      return
    }
    case 'seedCanvasDocuments':
      for (const name of step.names) {
        await page.evaluate((documentName) => window.henjiNative.testFixtures.createCanvas({ name: documentName, replace: true }), name)
      }
      return
    case 'seedCanvas':
      await seedCanvasFixture(page, context, step)
      return
    case 'seedAssistant': {
      if (runtime.assistantFixture) {
        await runtime.assistantFixture.cleanup()
        runtime.assistantFixture = null
      }
      runtime.assistantFixture = await seedAssistantFixture(page, step)
      return
    }
    case 'releaseAssistant':
      if (!runtime.assistantFixture) throw new Error('releaseAssistant 之前需要 seedAssistant')
      runtime.assistantFixture.release()
      return
    case 'seedHistory': {
      if (runtime.historyFixture) await runtime.historyFixture.cleanup()
      runtime.historyFixture = await seedHistoryFixture(runtime.mainPage, context, step)
      return
    }
    case 'logsWindow': {
      if (!runtime.logsPage || runtime.logsPage.isClosed()) {
        await runtime.mainPage.evaluate(() => window.henjiNative.logging.openLogWindow())
        // 日志窗口可能是前面场景打开过、现在只被聚焦的那一个；新建时页面先是 about:blank 再载入 ?view=logs，
        // 所以按地址轮询已有窗口，而不是只等一次 window 事件
        const findLogs = () => runtime.app.windows().find((candidate) => !candidate.isClosed() && candidate.url().includes('view=logs'))
        const deadline = Date.now() + 15000
        while (!findLogs() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
        runtime.logsPage = findLogs()
        if (!runtime.logsPage) throw new Error('日志窗口 15 秒内没有打开')
        await runtime.logsPage.waitForLoadState('domcontentloaded')
        await runtime.logsPage.locator('header').first().waitFor({ state: 'visible', timeout: 15000 })
        // 与主窗口同尺寸（窗口内容区），960 / 1440 两档截图都落在日志窗口自己的布局上
        const size = await runtime.mainPage.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
        await runtime.app.evaluate(({ BrowserWindow }, target) => {
          const logs = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('view=logs'))
          if (logs) logs.setContentSize(target.width, target.height)
        }, size)
        await runtime.logsPage.waitForFunction((target) => window.innerWidth === target.width, size, { timeout: 5000 })
          .catch(() => undefined)
      }
      runtime.activePage = runtime.logsPage
      await context.settlePage(runtime.logsPage)
      return
    }
    case 'mainWindow':
      runtime.activePage = null
      return
    case 'sweepLayout':
      await sweepLayout(page, step, runtime)
      return
    case 'capture':
    case 'metrics': {
      const suffix = prefix ? `${prefix}-${step.name}` : step.name
      if (step.action === 'capture') await ctx.capture(suffix, runtime.activePage ? { page: runtime.activePage } : undefined)
      if (step.metrics) {
        const metrics = await measureTarget(page, step.metrics)
        ctx.recordMetrics?.({ suffix, variant: variant?.id ?? null, metrics })
      }
      return
    }
    default:
      throw new Error(`未实现的动作：${step.action}`)
  }
}

/** 规则结果里每一处命中的去重键（不含像素对比度与跨场景标题，它们不由 DOM 扫描产生）。 */
function ruleIssueKeys(rules) {
  return UI_AUDIT_RULES.filter((rule) => rule.key !== 'lowContrast' && rule.key !== 'pageTitleInconsistency')
    .flatMap((rule) => (rules[rule.key] ?? []).map((item) => `${rule.key}|${item.element ?? JSON.stringify(item)}`))
}
function onlyIssues(rules, keys) {
  const wanted = new Set(keys)
  const result = { notes: rules.notes ?? [], gallerySamples: [], pageTitles: [] }
  for (const rule of UI_AUDIT_RULES) result[rule.key] = (rules[rule.key] ?? []).filter((item) => wanted.has(`${rule.key}|${item.element ?? JSON.stringify(item)}`))
  return result
}

async function sweepLayout(page, step, runtime) {
  const { ctx, context } = runtime
  if (typeof ctx.auditRules !== 'function') throw new Error('sweepLayout 需要巡检执行器提供 auditRules')
  const seen = new Set(ruleIssueKeys(await ctx.auditRules(page)))
  const findings = []
  let shots = 0
  const check = async (label, captureAllowed) => {
    await waitForStable(page, context.settlePage, { timeout: 4000 }).catch(() => undefined)
    const rules = await ctx.auditRules(page)
    const fresh = ruleIssueKeys(rules).filter((key) => !seen.has(key))
    if (!fresh.length) return
    for (const key of fresh) seen.add(key)
    shots += 1
    const suffix = `${runtime.prefix ? `${runtime.prefix}-` : ''}${step.name}-${String(shots).padStart(2, '0')}`
    findings.push({ label, suffix, issues: fresh })
    console.log(`  ! 尺寸扫描 ${label}：新增 ${fresh.length} 处（${fresh.slice(0, 3).join('；')}）`)
    ctx.recordRules?.(suffix, { ...onlyIssues(rules, fresh), notes: [`尺寸扫描：${label}`] })
    if (captureAllowed) await ctx.capture(suffix)
  }
  if (step.sashes) {
    const root = step.within ? resolveTarget(page, step.within) : page.locator('.dv-dockview:visible').first()
    const sashes = root.locator('.dv-sash:visible')
    const count = await sashes.count()
    for (let index = 0; index < count; index += 1) {
      const sash = sashes.nth(index)
      const box = await sash.boundingBox().catch(() => null)
      if (!box || box.width <= 0 || box.height <= 0) continue
      const vertical = box.height > box.width
      const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      for (const direction of [-1, 1]) {
        let current = origin
        for (let n = 1; n <= step.maxSteps; n += 1) {
          const target = vertical ? { x: current.x + direction * step.step, y: current.y } : { x: current.x, y: current.y + direction * step.step }
          await page.mouse.move(current.x, current.y)
          await page.mouse.down()
          await page.mouse.move(target.x, target.y, { steps: 6 })
          await page.mouse.up()
          const after = await sash.boundingBox().catch(() => null)
          if (!after) break
          const next = { x: after.x + after.width / 2, y: after.y + after.height / 2 }
          const moved = vertical ? Math.abs(next.x - current.x) : Math.abs(next.y - current.y)
          current = next
          await check(`分隔条 ${index + 1}（${vertical ? '左右' : '上下'}）${direction < 0 ? (vertical ? '向左' : '向上') : (vertical ? '向右' : '向下')} ${n} 档`, true)
          // 两侧面板已到最小尺寸，分隔条拖不动了
          if (moved < 2) break
        }
        // 复原到起点，再扫另一个方向
        await page.mouse.move(current.x, current.y)
        await page.mouse.down()
        await page.mouse.move(origin.x, origin.y, { steps: 6 })
        await page.mouse.up()
      }
    }
  }
  if (step.windows.length) {
    if (typeof ctx.setWindowSize !== 'function' || !ctx.requestedWindowSize) throw new Error('sweepLayout.windows 需要巡检执行器提供窗口尺寸控制')
    try {
      for (const size of step.windows) {
        // 分数 DPI 下小窗口可能差几个像素（窗口最小尺寸、系统取整）：按实际尺寸继续扫，不中断
        try { await ctx.setWindowSize(size) } catch (error) { console.log(`  尺寸扫描 窗口 ${size.width}×${size.height}：${String(error.message).split(String.fromCharCode(10))[0]}，按实际尺寸继续`) }
        await check(`窗口 ${size.width}×${size.height}`, false)
      }
    } finally {
      await ctx.setWindowSize(ctx.requestedWindowSize)
      await waitForStable(page, context.settlePage, { timeout: 4000 }).catch(() => undefined)
    }
  }
  runtime.sweepFindings.push(...findings)
  console.log(`  尺寸扫描 ${step.name}：${findings.length ? `${findings.length} 档出现新问题` : '没有新问题'}`)
}

async function runSteps(mainPage, steps, runtime) {
  for (const step of steps) {
    // logsWindow 之后的步骤在日志窗口里执行
    const page = runtime.activePage ?? mainPage
    if (step.ifPresent && !(await resolveTarget(page, step.ifPresent).isVisible())) continue
    try {
      await runStep(page, step, runtime)
    } catch (error) {
      if (step.optional) {
        runtime.skipped.push(`${runtime.prefix || '-'} / ${step.action}：${error.message.split('\n')[0]}`)
        continue
      }
      throw error
    }
  }
}

/** 步骤描述 → 场景对象。变体逐个执行：单个变体失败不中断其余变体，最后汇总抛出（截图保留）。 */
function compileStepScene(spec, context) {
  return {
    id: spec.id,
    surface: spec.surface,
    name: spec.name,
    checklist: spec.checklist,
    sourceFile: spec.sourceFile,
    scrollCoverage: spec.scrollCoverage,
    writesUserData: spec.writesUserData,
    ...(spec.expectedLogEvents ? { expectedLogEvents: spec.expectedLogEvents } : {}),
    ...(spec.expectedBrowserErrors ? { expectedBrowserErrors: spec.expectedBrowserErrors } : {}),
    launchArgs: spec.launchArgs,
    launchEnv: spec.launchEnv,
    setup: async (page, electronApp, ctx) => {
      // 付费保护：步骤场景里任何误触的“生成”或对真实任务的续查都到不了供应商（uiReviewPaidGuard.cjs）
      if (!electronApp || typeof electronApp.evaluate !== 'function') throw new Error('步骤场景缺少 Electron 应用，无法加付费保护')
      const unblockPaidGeneration = await blockPaidGeneration(electronApp)
      const runtime = { context, ctx, prefix: '', variant: null, skipped: [], mouseDown: false, assistantFixture: null, sceneId: spec.id, dialogsStubbed: false, audioEditFixtures: [],
        app: electronApp, mainPage: page, activePage: null, logsPage: null, historyFixture: null, sweepFindings: [] }
      try {
        await runSteps(page, spec.prepare, runtime)
        if (!spec.variants) {
          await runSteps(page, spec.steps, runtime)
          return
        }
        const variants = spec.variants.list
          ?? filterVariants(await VARIANT_SOURCES[spec.variants.source](page, context), spec.variants)
        const failures = []
        for (const variant of variants) {
          runtime.prefix = variant.id
          runtime.variant = variant
          try {
            const steps = spec.rawSteps.map((step, index) => (
              normalizeStep(expandTemplate(step, variant), `${spec.sourceFile} steps[${index}] / ${variant.id}`)
            ))
            await runSteps(page, steps, runtime)
          } catch (error) {
            failures.push(`${variant.id}：${error.message.split('\n')[0]}`)
            // 控制台多带几行 Playwright 调用记录（等的是哪个元素、被谁挡住），汇总里仍只留第一行
            console.error(`  ✗ 变体 ${variant.id}：${error.message.split('\n').slice(0, 12).join('\n      ')}`)
          } finally {
            if (runtime.mouseDown) {
              await page.mouse.up().catch(() => undefined)
              runtime.mouseDown = false
            }
            await releaseModifiers(page, runtime).catch(() => undefined)
            await context.closeTransientUi(page).catch(() => undefined)
          }
        }
        console.log(`  变体 ${variants.length} 个，失败 ${failures.length} 个`)
        if (failures.length) throw new Error(`${failures.length}/${variants.length} 个变体失败：${failures.slice(0, 10).join('；')}`)
      } finally {
        if (runtime.mouseDown) await page.mouse.up().catch(() => undefined)
        await releaseModifiers(page, runtime).catch(() => undefined)
        if (runtime.assistantFixture) await runtime.assistantFixture.cleanup().catch(() => undefined)
        if (runtime.logsPage && !runtime.logsPage.isClosed()) await runtime.logsPage.close().catch(() => undefined)
        if (runtime.historyFixture) await runtime.historyFixture.cleanup().catch(() => undefined)
        for (const fixture of runtime.audioEditFixtures) await fixture.cleanup().catch(() => undefined)
        if (runtime.dialogsStubbed) {
          await electronApp.evaluate(({ dialog }) => {
            const store = globalThis.__henjiUiReviewDialogs
            if (!store) return
            dialog.showSaveDialog = store.save
            dialog.showOpenDialog = store.open
            delete globalThis.__henjiUiReviewDialogs
          }).catch(() => undefined)
        }
        // 开发入口靠地址参数打开：场景结束回到普通地址。设计系统中心这类全窗口入口留着会盖住后面的场景，
        // 后面场景里的重载也会把它重新打开（重要记录 020：两档尺寸连跑时 960 的头几个场景全部找不到页面）
        if (runtime.devSurfaceEntered) await leaveDevSurface(page, context).catch(() => undefined)
        // IPC 替身先于付费保护恢复：生成通道替身保存的“替换前处理器”就是付费保护的拒绝处理器
        if (runtime.ipcStubbed) await restoreIpcStubs(electronApp)
        await unblockPaidGeneration()
        if (runtime.skipped.length) console.log(`  可选步骤跳过 ${runtime.skipped.length} 个：${runtime.skipped.slice(0, 5).join('；')}`)
      }
    },
  }
}

function loadStepSpecFile(file, root = ROOT) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file)
  if (!fs.existsSync(resolved)) throw new Error(`步骤描述文件不存在：${file}`)
  const raw = /\.(c?js)$/.test(resolved)
    ? require(resolved)
    : JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const relative = path.relative(root, resolved).replace(/\\/g, '/')
  return (Array.isArray(raw) ? raw : [raw]).map((spec) => normalizeStepSpec(spec, relative))
}

function loadStepScenes(files, context, root = ROOT) {
  const specs = files.flatMap((file) => loadStepSpecFile(file, root))
  const duplicate = specs.find((spec, index) => specs.findIndex((other) => other.id === spec.id) !== index)
  if (duplicate) throw new Error(`步骤描述 id 重复：${duplicate.id}`)
  return specs.map((spec) => compileStepScene(spec, context))
}

module.exports = {
  STEP_ACTIONS,
  VARIANT_SOURCES,
  buildDevSurfaceUrl,
  compileStepScene,
  expandTemplate,
  filterVariants,
  loadStepScenes,
  loadStepSpecFile,
  normalizeStep,
  normalizeStepSpec,
  normalizeTarget,
  parsePattern,
  pointInBox,
  resolveFixtureFile,
  resolveTarget,
  sanitizeSuffix,
  variantId,
  waitForStable,
}
