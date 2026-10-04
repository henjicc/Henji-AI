/**
 * 界面核对的主进程 IPC 替身（任务 5.8 第二块）：把一个 invoke 通道临时换成“挂起 / 拒绝 / 延迟后照常执行”，
 * 用来截“上传中”“同步中”“克隆中 / 失败”“检查更新中”“生成中”这类只靠真实执行或真实失败才看得到的状态。
 *
 * - hold：调用一直挂起，直到 releaseIpc（放行时按 release 决定：reject 报错，original 交给替换前的处理器）；
 * - reject：立刻以给定文案失败，走界面正式的失败提示；
 * - delay：等 ms 后交给替换前的处理器（只给本机操作，如复制文件、读目录）；
 * - resolve：直接返回给定数据（如“供应商密钥已配置”），不调用替换前的处理器。
 *
 * 付费与模型通道（`ai:` / `llm:` / `embedded-agent:` / 语音识别 `audioEdit:asr:`）不允许 delay，放行也只能 reject：
 * 替换前的处理器可能是真实供应商调用。生成通道本身还被 uiReviewPaidGuard 换成了拒绝处理器，
 * 这里保存并恢复的是“当前处理器”，所以嵌套在付费保护之内也只会回到付费保护。
 * 场景结束一律恢复（同一通道多次替换按栈恢复），未放行的挂起调用以“核对结束”拒绝。
 */
const IPC_STUB_MODES = Object.freeze(['hold', 'reject', 'delay', 'resolve'])
const PAID_CHANNEL_PATTERN = /^(ai|llm|embedded-agent):|^audioEdit:asr:/

function normalizeStubIpc(value) {
  const channel = value?.channel
  if (typeof channel !== 'string' || !/^[a-z][\w-]*(:[\w-]+)+$/i.test(channel)) throw new Error('stubIpc 需要 channel（如 "media:copyToDataDir"）')
  const mode = value.mode ?? 'hold'
  if (!IPC_STUB_MODES.includes(mode)) throw new Error(`stubIpc.mode 只能是 ${IPC_STUB_MODES.join('、')}`)
  const paid = PAID_CHANNEL_PATTERN.test(channel)
  if (paid && mode === 'delay') throw new Error(`stubIpc：${channel} 是付费或模型通道，不允许 delay（会调用真实处理器）`)
  const ms = mode === 'delay' ? Number(value.ms ?? 3000) : 0
  if (mode === 'delay' && !(Number.isInteger(ms) && ms > 0 && ms <= 60000)) throw new Error('stubIpc.ms 需要 1–60000 的整数')
  const message = String(value.message ?? '核对夹具：模拟失败')
  // 失败的返回形状：大多数通道走 registerIpcHandler 的结果信封（{ ok: false, error }），少数直接抛错（如生成通道）
  const shape = value.shape ?? 'envelope'
  if (!['envelope', 'throw'].includes(shape)) throw new Error('stubIpc.shape 只能是 envelope 或 throw')
  return { channel, mode, ms, message, paid, shape, data: value.data ?? null }
}

function normalizeReleaseIpc(value) {
  const channel = value?.channel
  if (typeof channel !== 'string') throw new Error('releaseIpc 需要 channel')
  const release = value.release ?? 'reject'
  if (!['reject', 'original'].includes(release)) throw new Error('releaseIpc.release 只能是 reject 或 original')
  if (release === 'original' && PAID_CHANNEL_PATTERN.test(channel)) throw new Error(`releaseIpc：${channel} 是付费或模型通道，放行只能 reject`)
  const shape = value.shape ?? 'envelope'
  if (!['envelope', 'throw'].includes(shape)) throw new Error('releaseIpc.shape 只能是 envelope 或 throw')
  return { channel, release, message: String(value.message ?? '核对夹具：模拟失败'), shape }
}

/** 主进程内执行（electronApp.evaluate 回调，不能引用外部变量）。 */
function installStubInMain({ ipcMain }, { channel, mode, ms, message, shape, data }) {
  const fail = (text) => {
    if (shape === 'throw') throw new Error(text)
    return { ok: false, error: { name: 'Error', message: text, code: 'UiReviewFixture' } }
  }
  const handlers = ipcMain._invokeHandlers
  if (!handlers || typeof handlers.get !== 'function') throw new Error('无法读取主进程 IPC 处理器，拒绝替换')
  const current = handlers.get(channel)
  if (!current) throw new Error(`主进程没有注册 ${channel}`)
  const store = globalThis.__henjiUiReviewIpcStubs ?? (globalThis.__henjiUiReviewIpcStubs = { stacks: {}, pending: {} })
  ;(store.stacks[channel] ??= []).push(current)
  store.pending[channel] ??= []
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args) => {
    if (mode === 'reject') return fail(message)
    if (mode === 'resolve') return shape === 'throw' ? data : { ok: true, data }
    if (mode === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return current(event, ...args)
    }
    return new Promise((resolve, reject) => {
      store.pending[channel].push({ resolve, reject, shape, call: () => current(event, ...args) })
    })
  })
}

function releaseStubInMain(_electron, { channel, release, message }) {
  const failure = (item, text) => (item.shape === 'throw'
    ? item.reject(new Error(text))
    : item.resolve({ ok: false, error: { name: 'Error', message: text, code: 'UiReviewFixture' } }))
  const store = globalThis.__henjiUiReviewIpcStubs
  const pending = store?.pending?.[channel] ?? []
  const count = pending.length
  for (const item of pending.splice(0)) {
    if (release === 'original') Promise.resolve().then(item.call).then(item.resolve, item.reject)
    else failure(item, message)
  }
  return count
}

function restoreAllInMain({ ipcMain }) {
  const store = globalThis.__henjiUiReviewIpcStubs
  if (!store) return
  for (const [channel, pending] of Object.entries(store.pending)) {
    for (const item of pending.splice(0)) {
      if (item.shape === 'throw') item.reject(new Error('界面核对结束'))
      else item.resolve({ ok: false, error: { name: 'Error', message: '界面核对结束', code: 'UiReviewFixture' } })
    }
    const stack = store.stacks[channel] ?? []
    const original = stack[0]
    ipcMain.removeHandler(channel)
    if (original) ipcMain.handle(channel, original)
  }
  delete globalThis.__henjiUiReviewIpcStubs
}

async function stubIpc(app, step) {
  await app.evaluate(installStubInMain, { channel: step.channel, mode: step.mode, ms: step.ms, message: step.message, shape: step.shape, data: step.data })
}

async function releaseIpc(app, step) {
  return app.evaluate(releaseStubInMain, step)
}

async function restoreIpcStubs(app) {
  await app.evaluate(restoreAllInMain).catch(() => undefined)
}

module.exports = {
  IPC_STUB_MODES,
  PAID_CHANNEL_PATTERN,
  normalizeReleaseIpc,
  normalizeStubIpc,
  releaseIpc,
  restoreIpcStubs,
  stubIpc,
}
