import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from '../window'
import { localHostRegistrationSchema, localHostReplySchema } from '../../../src/core/application-control/localHostContracts'
import { initializeApplicationRuntime } from '../services/application-runtime/runtime'
import { registerIpcHandler } from './registry'
import { hostContextSnapshotSchema } from '../../../src/core/application-control/hostContracts'
import { operationReviewCommandSchema } from '../../../src/core/application-control/operationReview'
import { createMainLogger } from '../services/logging'
import { contentTrustCommandSchema } from '../../../src/core/contentTrust'
import { executeContentTrust } from '../services/content-trust/commands'
import { resumeContentTrustConfirmations } from '../services/content-trust/confirmation'
export function assertTrustedApplicationSender(event: IpcMainInvokeEvent): void {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || BrowserWindow.fromWebContents(event.sender) !== window || event.senderFrame !== event.sender.mainFrame) throw new Error('不可信的连接管理请求。')
  const url = event.senderFrame.url
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl ? new URL(url).origin !== new URL(developmentUrl).origin : !url.startsWith('file://')) throw new Error('不可信的连接管理来源。')
}
const trusted = assertTrustedApplicationSender
const watched = new WeakSet<Electron.WebContents>()
const crashWatched = new WeakSet<Electron.WebContents>()
const logger = createMainLogger('main.application_runtime')

/**
 * 渲染进程异常退出后 webContents 仍在、也没有导航；不在这里通知宿主，宿主会一直显示就绪，外部调用只能等到超时。
 * 窗口一创建就挂上，首次注册之前崩溃也要进入“界面已崩溃”。recovering 与窗口是否自动重载保持一致，
 * 决定对外是“正在恢复、可重试”还是“本次运行无法继续”。
 */
export function watchApplicationHostRenderer(contents: Electron.WebContents, options: { recovering: boolean } = { recovering: true }): void {
  if (crashWatched.has(contents)) return
  crashWatched.add(contents)
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    initializeApplicationRuntime().host.rendererCrashed(options.recovering)
    logger.warn('应用界面崩溃，宿主已断开', { event: 'application.host.renderer_crashed', context: { reason: details.reason, exitCode: details.exitCode } })
  })
}

export function registerApplicationControlIpc(): void {
  registerIpcHandler('application:content-trust', value => contentTrustCommandSchema.parse(value), async command => {
    const result = await executeContentTrust(command)
    if (command.action === 'decide' || command.action === 'set-policy') void resumeContentTrustConfirmations().catch(error => logger.warn('外来内容确认续接失败', { event: 'content_trust.resume.failed', error }))
    return result
  }, trusted)
  const { host, operations, reviewOperation } = initializeApplicationRuntime()
  registerIpcHandler('application:host:context', value => hostContextSnapshotSchema.parse(value), input => host.publishContext(input), trusted)
  registerIpcHandler('application:host:register', (value) => localHostRegistrationSchema.parse(value), (input, event) => {
    watchApplicationHostRenderer(event.sender)
    if (!watched.has(event.sender)) {
      watched.add(event.sender)
      // 页内导航（pushState/hash）不换渲染进程，宿主与上下文仍然有效，只有整页导航才断开。
      event.sender.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) host.disconnect() })
      event.sender.once('destroyed', () => host.disconnect())
    }
    const recovering = host.hostUnavailable?.reason
    host.register(input, { send: (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload) } })
    if (recovering && host.ready) logger.info('应用界面恢复，宿主重新就绪', { event: 'application.host.recovered', context: { reason: recovering } })
    if (input.ready) {
      host.publishReviews()
      // 一次注册串行核验原记录，避免同时读取许多大型文档；不重放任何写入。
      void (async () => {
        for (const record of operations.store.unresolved()) {
          if (!host.ready || host.rendererEpoch !== input.rendererEpoch) break
          await reviewOperation(record, false)
        }
      })().catch(error => logger.warn('恢复核对未完成', { event: 'application.confirmation.restore_failed', error }))
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
