import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { AudioCaptureError } from './protocol'

export function audioCaptureExecutablePath(): string {
  const name = `henji-audio-capture${process.platform === 'win32' ? '.exe' : ''}`
  // 未打包的生产启动入口在 out/main；与音频处理程序一致，从启动工作目录定位原生程序。
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'resources', name) : path.join(process.cwd(), 'native/audio-capture/target/release', name)
  if (!existsSync(executable)) throw new AudioCaptureError('ENGINE_MISSING', '原生录音引擎缺失，请修复安装')
  return executable
}
