/**
 * 界面核对的付费保护（共享助手）：核对期间把主进程的 `ai:generate` 换成直接拒绝的处理器，
 * `ai:continuePolling` 只放行夹具任务（任务号以 `__` 开头，交给进场时已登记的处理器），其余一律拒绝。
 * 任何误触的“生成”或对真实任务的续查都到不了供应商；收尾恢复进场时的处理器。
 *
 * 嵌套安全：同一主进程里多处同时加保护时按引用计数，最后一个退出时才恢复。
 * 不要求隔离资料目录：拦截本身只会减少副作用，真实资料目录下的只读核对同样需要它。
 * 助手替身（uiReviewAssistantFixture.cjs）走的是本机 HTTP，不经过这两个通道，不受影响。
 *
 * 使用方：compileStepScene（所有 --steps 场景的统一入口）；生成核对场景可直接改用本函数。
 */
const PAID_GENERATION_CHANNELS = Object.freeze(['ai:generate', 'ai:continuePolling'])
const FIXTURE_TASK_PATTERN_SOURCE = '^__'

/** 在主进程里执行（electronApp.evaluate 的回调，不能引用外部变量，参数经第二个实参传入）。 */
function installGuardInMain({ ipcMain }, { channels, fixturePattern }) {
  const store = globalThis.__henjiReviewPaidGuard ?? { originals: null, depth: 0 }
  if (store.depth === 0) {
    // Electron 把 invoke 处理器存在 ipcMain._invokeHandlers（Map）；取不到就不动它，宁可报错也不留下没有处理器的主进程
    const handlers = ipcMain._invokeHandlers
    if (!handlers || typeof handlers.get !== 'function') throw new Error('无法读取主进程生成处理器，拒绝替换（付费保护）')
    store.originals = Object.fromEntries(channels.map((channel) => [channel, handlers.get(channel) ?? null]))
    const fixture = new RegExp(fixturePattern)
    ipcMain.removeHandler('ai:generate')
    ipcMain.handle('ai:generate', async () => { throw new Error('界面核对实例禁止真实生成（付费保护）') })
    ipcMain.removeHandler('ai:continuePolling')
    ipcMain.handle('ai:continuePolling', async (event, request) => {
      const original = store.originals?.['ai:continuePolling']
      if (!request || !fixture.test(String(request.taskId ?? '')) || !original) {
        throw new Error('界面核对实例只允许续查夹具任务（付费保护）')
      }
      return original(event, request)
    })
  }
  store.depth += 1
  globalThis.__henjiReviewPaidGuard = store
}

function removeGuardInMain({ ipcMain }, { channels }) {
  const store = globalThis.__henjiReviewPaidGuard
  if (!store) return
  store.depth -= 1
  if (store.depth > 0) return
  for (const channel of channels) {
    ipcMain.removeHandler(channel)
    const original = store.originals?.[channel]
    if (original) ipcMain.handle(channel, original)
  }
  delete globalThis.__henjiReviewPaidGuard
}

/** 加保护并返回恢复函数。`app` 是 Playwright 的 ElectronApplication（或同形替身）。 */
async function blockPaidGeneration(app) {
  const args = { channels: [...PAID_GENERATION_CHANNELS], fixturePattern: FIXTURE_TASK_PATTERN_SOURCE }
  await app.evaluate(installGuardInMain, args)
  let restored = false
  return async () => {
    if (restored) return
    restored = true
    await app.evaluate(removeGuardInMain, args).catch(() => undefined)
  }
}

module.exports = { PAID_GENERATION_CHANNELS, blockPaidGeneration }
