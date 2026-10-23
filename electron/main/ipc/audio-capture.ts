import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { audioCaptureRequestSchema } from '../../../src/core/audioCapture/contracts'
import { AUDIO_CAPTURE_CHANNEL, AUDIO_CAPTURE_EVENT_CHANNEL } from '../../../src/platform/contracts/audioCapture'
import { assertTrustedApplicationSender } from './application-control'
import { registerIpcHandler } from './registry'
import { isRealPathWithinAllowedMediaRoots } from '../protocol'
import { mediaPermissions } from '../services/media-permissions'
import { AudioCaptureService } from '../services/audio-capture/service'
import { AudioCaptureError } from '../services/audio-capture/protocol'
import { mainClockUs } from '../services/audio-capture/client'
import { createMainLogger } from '../services/logging'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { AudioCaptureFiles } from '../services/audio-capture/files'
import { getUserRootDir } from '../services/appPaths'
import { getSettingsStore } from '../services/settings/store'

/** 调用方提供文件位置，父目录必须已经由作品/媒体路径通道授权；原生端 create_new 禁止覆盖。 */
export async function authorizedCapturePath(target: string, existing = false): Promise<string> {
  if (!path.isAbsolute(target) || target.includes('\0') || path.extname(target).toLowerCase() !== '.wav') throw new AudioCaptureError('PATH_DENIED', '请使用已授权目录内的 WAV 文件位置')
  const parent = await fs.realpath(path.dirname(target))
  const temp = await fs.realpath(app.getPath('temp'))
  const relative = path.relative(temp, parent)
  const inTemp = !relative.startsWith('..') && !path.isAbsolute(relative)
  if (!inTemp && !await isRealPathWithinAllowedMediaRoots(parent)) throw new AudioCaptureError('PATH_DENIED', '录音位置尚未授权，请先选择作品目录或保存目录')
  const resolved = path.join(parent, path.basename(target))
  if (existing && (await fs.lstat(resolved)).isSymbolicLink()) throw new AudioCaptureError('PATH_DENIED', '不能通过符号链接恢复录音文件')
  return resolved
}
export function audioCaptureExecutablePath(): string {
    const name = `henji-audio-capture${process.platform === 'win32' ? '.exe' : ''}`
    // 未打包的生产启动入口在 out/main；与音频处理程序一致，从启动工作目录定位原生程序。
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'resources', name) : path.join(process.cwd(), 'native/audio-capture/target/release', name)
    if (!existsSync(executable)) throw new AudioCaptureError('ENGINE_MISSING', '原生录音引擎缺失，请修复安装')
    return executable
}
export function registerAudioCaptureIpc(): void {
  const logger = createMainLogger('main.audio_capture.ipc')
  const service = new AudioCaptureService(audioCaptureExecutablePath, undefined, (owner, event) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed() && isTrustedMainRendererUrl(win.webContents.getURL()) && (owner === undefined || win.webContents.id === owner)) win.webContents.send(AUDIO_CAPTURE_EVENT_CHANNEL, event)
  })
  const watched = new Set<number>()
  const files = new AudioCaptureFiles(getUserRootDir, getSettingsStore, target => shell.trashItem(target))
  app.once('before-quit', () => service.dispose())
  registerIpcHandler(AUDIO_CAPTURE_CHANNEL, raw => audioCaptureRequestSchema.parse(raw), async (request, event) => {
    const owner = event.sender.id
    if (!watched.has(owner)) {
      watched.add(owner)
      const release = (): void => { void service.run(() => service.releaseOwner(owner)).catch(error => logger.warn('窗口退出时录音停止失败', { event: 'audio_capture.owner.failed', error })) }
      event.sender.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame !== false) release() })
      event.sender.on('render-process-gone', release)
      event.sender.once('destroyed', () => { release(); watched.delete(owner) })
    }
    if (request.action === 'clock') return { mainUs: mainClockUs(), uncertaintyUs: 0 }
    if (request.action === 'ack') return service.acknowledge(owner, request.sessionId, request.sequence)
    return service.run(async () => {
      assertTrustedApplicationSender(event)
      switch (request.action) {
        case 'prepareFile': return files.prepare(new Date(), request.placement)
        case 'pendingFiles': return files.pending()
        case 'completeFile': return files.complete(request.outputPath)
        case 'trashFile': {
          if (service.isRecordingPath(request.outputPath)) throw new Error('请先停止录音，再放弃文件')
          return files.discard(request.outputPath)
        }
        case 'enumerate': return service.enumerate()
        case 'watchDevices': return service.watchDevices(owner, request.enabled)
        case 'settings': return service.getSettings()
        case 'setSettings': return service.setSettings(request.settings, request.expectedRevision)
        case 'probe': return service.probe(request.settings)
        case 'start': {
          const outputPath = await authorizedCapturePath(request.request.outputPath)
          await mediaPermissions.requestAccess(['microphone'])
          assertTrustedApplicationSender(event)
          return service.start(owner, { ...request.request, outputPath })
        }
        case 'pause': case 'resume': case 'stop': case 'status': return service.control(owner, request.action, request.sessionId)
        case 'asioPanel': return service.openAsioPanel(request.settings)
        case 'recover': return service.recover(await authorizedCapturePath(request.outputPath, true))
      }
    })
  }, assertTrustedApplicationSender)
}
