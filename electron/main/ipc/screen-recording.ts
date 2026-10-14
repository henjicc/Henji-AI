import { screenRecordingRequestSchema } from '../../../src/core/screenRecording/contracts'
import { assertTrustedApplicationSender } from './application-control'
import { registerIpcHandler } from './registry'
import { mediaPermissions } from '../services/media-permissions'
import { isRecordingControlSender, isRecordingFrameSender, recordingControl, recordRecordingCapability, updateRecordingTracks } from '../services/screen-recording/runtime'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { createMainLogger } from '../services/logging'
import { recordRecordingSensitiveDom } from '../services/screen-recording/runtime'

export function registerScreenRecordingIpc(): void {
  const logger = createMainLogger('main.screen_recording.ipc')
  registerIpcHandler('screenRecording:request', raw => screenRecordingRequestSchema.parse(raw), async (request, event) => {
    if (request.action !== 'snapshot' && request.action !== 'control') assertTrustedApplicationSender(event)
    else if (!isRecordingControlSender(event.sender) && !(request.action === 'snapshot' && isRecordingFrameSender(event.sender))) {
      // 主窗口可以查询空会话；辅助窗口不能控制别人的会话。
      assertTrustedApplicationSender(event)
    }
    if (request.action === 'control' && recordingControl.snapshot()?.sessionId !== request.sessionId) throw new Error('录制会话已改变，请刷新后重试')
    try {
      switch (request.action) {
        case 'dom-privacy': return recordRecordingSensitiveDom(event.sender, request.sessionId, request.regions)
        case 'clock': return Number(process.hrtime.bigint() / 1000n)
        case 'track-status': return updateRecordingTracks(event.sender, request.sessionId, request.status)
        case 'capture': return await (await import('../services/screen-recording/capture/service')).handleCaptureRequest(event.sender, request.request)
        case 'capability': return recordRecordingCapability(event.sender, request.sessionId, request.fact)
        case 'sources': return await mediaPermissions.sources(request.excludedSourceIds)
        case 'permissions': return mediaPermissions.statuses()
        case 'grant': {
          await mediaPermissions.requestAccess(request.kinds)
          // OS 弹窗期间宿主可能已经导航或关闭，提交前再次核对。
          assertTrustedApplicationSender(event)
          mediaPermissions.grant(event.sender, request.sessionId, request.kinds, request.selection)
          return
        }
        case 'revoke':
          mediaPermissions.revoke(event.sender, request.sessionId)
          return await (await import('../services/screen-recording/capture/service')).revokeCaptureSession(event.sender, request.sessionId)
        case 'settings': return await mediaPermissions.openSettings(request.kind)
        case 'snapshot': return recordingControl.snapshot()
        case 'shortcuts': return recordingControl.configureShortcuts(request.shortcuts)
        case 'control': await (request.note === undefined ? recordingControl.command(request.command) : recordingControl.command(request.command, request.note)); return recordingControl.snapshot()
      }
    } catch (error) { logger.warn('录制请求未完成', { event: 'recording.request.failed', context: { action: request.action }, error }); throw error }
  }, event => {
    if (event.senderFrame !== event.sender.mainFrame || !isTrustedMainRendererUrl(event.senderFrame.url)) throw new Error('录制请求来源不可信')
  })
}
