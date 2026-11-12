import { app, BrowserWindow, webContents } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { audioCaptureRequestSchema } from '../../../src/core/audioCapture/contracts'
import { AUDIO_CAPTURE_CHANNEL, AUDIO_CAPTURE_EVENT_CHANNEL } from '../../../src/platform/contracts/audioCapture'
import { assertTrustedApplicationSender } from './application-control'
import { registerIpcHandler } from './registry'
import { mediaPermissions } from '../services/media-permissions'
import { AudioCaptureService } from '../services/audio-capture/service'
import { AudioCaptureError } from '../services/audio-capture/protocol'
import { mainClockUs } from '../services/audio-capture/client'
import { createMainLogger } from '../services/logging'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { AudioCaptureFiles } from '../services/audio-capture/files'
import { getUserRootDir } from '../services/appPaths'
import { getSettingsStore } from '../services/settings/store'
import { trashUserFile } from '../services/recycle/runtime'
import { holdRecordingWakeLock } from '../services/recording-power'
import { notifyRecording } from '../services/recording-notice'

/** 原生端使用 create_new，避免覆盖同名文件。 */
export async function resolveCapturePath(target: string): Promise<string> {
  if (!path.isAbsolute(target) || target.includes('\0') || path.extname(target).toLowerCase() !== '.wav') throw new AudioCaptureError('PATH_DENIED', '请使用 WAV 文件的绝对路径')
  const parent = await fs.realpath(path.dirname(target))
  const resolved = path.join(parent, path.basename(target))
  return resolved
}
export function audioCaptureExecutablePath(): string {
    const name = `henji-audio-capture${process.platform === 'win32' ? '.exe' : ''}`
    // 未打包的生产启动入口在 out/main；与音频处理程序一致，从启动工作目录定位原生程序。
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'resources', name) : path.join(process.cwd(), 'native/audio-capture/target/release', name)
    if (!existsSync(executable)) throw new AudioCaptureError('ENGINE_MISSING', '原生录音引擎缺失，请修复安装')
    return executable
}

let disposeService: (() => Promise<void>) | undefined
/** 应用退出清理（bindApplicationShutdown 在 will-quit 执行）：关闭守卫已经停止并拼回录音之后才关录音服务。 */
export function disposeAudioCapture(): Promise<void> { return disposeService?.() ?? Promise.resolve() }

export function registerAudioCaptureIpc(): void {
  const logger = createMainLogger('main.audio_capture.ipc')
  const service = new AudioCaptureService(audioCaptureExecutablePath, undefined, (owner, event) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed() && isTrustedMainRendererUrl(win.webContents.getURL()) && (owner === undefined || win.webContents.id === owner)) win.webContents.send(AUDIO_CAPTURE_EVENT_CHANNEL, event)
  }, {
    holdWakeLock: holdRecordingWakeLock,
    // 音频编辑录音意外中断；窗口在前台时标题栏与录音面板已经显示中断，共用的提醒自己会跳过。
    interrupted: (owner, event) => notifyRecording(webContents.fromId(owner), '痕迹AI 录音已中断', event.error.message),
  })
  const watched = new Set<number>()
  const files = new AudioCaptureFiles(getUserRootDir, getSettingsStore, (file, placement) => trashUserFile(file, undefined, placement))
  // 不能在 before-quit 释放：它先于窗口关闭守卫，守卫再停止录音会报“服务已关闭”并否决退出，录音也拼不回去。
  disposeService = () => service.dispose()
  registerIpcHandler(AUDIO_CAPTURE_CHANNEL, raw => audioCaptureRequestSchema.parse(raw), async (request, event) => {
    const owner = event.sender.id
    if (!watched.has(owner)) {
      watched.add(owner)
      // 界面重载或崩溃时音频编辑录音继续（新界面用 active 接管），只结束随界面一起失去归属的麦克风订阅；窗口关掉才全部停止。
      const release = (keepRecording: boolean): void => { void service.run(() => service.releaseOwner(owner, { keepRecording })).catch(error => logger.warn('窗口退出时录音停止失败', { event: 'audio_capture.owner.failed', error })) }
      // 同文档内的地址变化（安全恢复启动时去掉地址参数、开发画廊改地址）不换页面，不算界面离开。
      event.sender.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => { if (mainFrame !== false && !inPlace) release(true) })
      event.sender.on('render-process-gone', () => release(true))
      event.sender.once('destroyed', () => { release(false); watched.delete(owner) })
    }
    if (request.action === 'clock') return { mainUs: mainClockUs(), uncertaintyUs: 0 }
    if (request.action === 'ack') return service.acknowledge(owner, request.sessionId, request.sequence)
    return service.run(async () => {
      assertTrustedApplicationSender(event)
      switch (request.action) {
        case 'prepareFile': return files.prepare(new Date(), request.placement)
        case 'pendingFiles': return files.pending()
        case 'active': return service.activeRecording(owner)
        case 'completeFile': return files.complete(request.outputPath)
        case 'trashFile': {
          if (service.isRecordingPath(request.outputPath)) throw new Error('请先停止录音，再放弃文件')
          await service.settled()
          return files.discard(request.outputPath)
        }
        case 'enumerate': return service.enumerate()
        case 'watchDevices': return service.watchDevices(owner, request.enabled)
        case 'settings': return service.getSettings()
        case 'setSettings': return service.setSettings(request.settings, request.expectedRevision)
        case 'probe': return service.probe(request.settings)
        case 'start': {
          const outputPath = await resolveCapturePath(request.request.outputPath)
          await mediaPermissions.requestAccess(['microphone'])
          assertTrustedApplicationSender(event)
          return service.start(owner, { ...request.request, outputPath })
        }
        case 'pause': case 'resume': case 'stop': case 'status': return service.control(owner, request.action, request.sessionId)
        case 'asioPanel': return service.openAsioPanel(request.settings)
        case 'recover': return service.recover(await resolveCapturePath(request.outputPath))
      }
    })
  }, assertTrustedApplicationSender)
}
