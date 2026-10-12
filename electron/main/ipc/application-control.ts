import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from '../window'
import { localHostRegistrationSchema, localHostReplySchema } from '../../../src/core/application-control/localHostContracts'
import { initializeApplicationRuntime } from '../services/application-runtime/runtime'
import { registerIpcHandler } from './registry'
import { hostContextSnapshotSchema } from '../../../src/core/application-control/hostContracts'
import { operationReviewCommandSchema } from '../../../src/core/application-control/operationReview'
import { createMainLogger } from '../services/logging'
export function assertTrustedApplicationSender(event: IpcMainInvokeEvent): void {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || BrowserWindow.fromWebContents(event.sender) !== window || event.senderFrame !== event.sender.mainFrame) throw new Error('不可信的连接管理请求。')
  const url = event.senderFrame.url
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl ? new URL(url).origin !== new URL(developmentUrl).origin : !url.startsWith('file://')) throw new Error('不可信的连接管理来源。')
}
const trusted = assertTrustedApplicationSender
const watched = new WeakSet<Electron.WebContents>()
export function registerApplicationControlIpc(): void {
  const { host, operations, reviewOperation } = initializeApplicationRuntime()
  registerIpcHandler('application:host:context', value => hostContextSnapshotSchema.parse(value), input => host.publishContext(input), trusted)
  registerIpcHandler('application:host:register', (value) => localHostRegistrationSchema.parse(value), (input, event) => {
    if (!watched.has(event.sender)) {
      watched.add(event.sender)
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) host.disconnect() })
      event.sender.once('destroyed', () => host.disconnect())
    }
    host.register(input, { send: (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload) } })
    if (input.ready) {
      host.publishReviews()
      // 一次注册串行核验原记录，避免同时读取许多大型文档；不重放任何写入。
      void (async () => {
        for (const record of operations.store.unresolved()) {
          if (!host.ready || host.rendererEpoch !== input.rendererEpoch) break
          await reviewOperation(record, false)
        }
      })().catch(error => createMainLogger('main.application_runtime').warn('恢复核对未完成', { event: 'application.confirmation.restore_failed', error }))
    }
  }, trusted)
  registerIpcHandler('application:host:complete', (value) => localHostReplySchema.parse(value), (input) => host.complete(input), trusted)
  registerIpcHandler('application:host:review', value => operationReviewCommandSchema.parse(value), async input => {
    if (input.action !== 'list') {
      const record = operations.store.get(input.operationId, input.callerId)
      if (!record) throw new Error('这项修改已不在待处理列表中。')
      if (input.action === 'open') await reviewOperation(record)
      else operations.resolveReview(input.operationId, input.callerId, input.decision)
    }
    return { items: operations.pendingReviews() }
  }, trusted)
}
