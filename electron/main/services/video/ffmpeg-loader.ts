import path from 'node:path'
import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'

/**
 * ffmpeg-ffprobe-static 导出的是基于 __dirname 算出来的二进制路径常量。
 * 打包后该路径落在 app.asar 里，二进制无法从 asar 虚拟文件系统内直接被子进程执行，
 * 必须重写成 electron-builder asarUnpack 生成的 app.asar.unpacked 真实磁盘路径。
 */
export function resolveUnpackedBinaryPath(binaryPath: string): string {
  const asarSegment = `${path.sep}app.asar${path.sep}`
  if (!binaryPath.includes(asarSegment)) return binaryPath
  return binaryPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`)
}

let ffmpegPathPromise: Promise<string> | null = null
let ffprobePathPromise: Promise<string> | null = null

export async function ensureExecutableBinary(binaryPath: string): Promise<string> {
  if (process.platform === 'win32') return binaryPath
  try {
    await fs.access(binaryPath, fsConstants.X_OK)
    return binaryPath
  } catch {
    // 某些 npm 缓存/迁移工具会丢掉下载二进制的 executable bit。开发目录可原地修复；
    // 安装包内必须由构建前门禁保证权限，不能运行后修改签名应用内容。
    if (binaryPath.includes(`${path.sep}app.asar.unpacked${path.sep}`)) {
      throw new Error(`Media binary is not executable: ${binaryPath}`)
    }
    await fs.chmod(binaryPath, 0o755)
    await fs.access(binaryPath, fsConstants.X_OK)
    return binaryPath
  }
}

export function loadFfmpegPath(): Promise<string> {
  if (!ffmpegPathPromise) {
    ffmpegPathPromise = import('ffmpeg-ffprobe-static')
      .then((mod) => {
        const raw = mod.ffmpegPath
        if (!raw) throw new Error('ffmpeg binary is unavailable on this platform')
        return ensureExecutableBinary(resolveUnpackedBinaryPath(raw))
      })
      .catch((error) => {
        ffmpegPathPromise = null
        throw error
      })
  }
  return ffmpegPathPromise
}

export function loadFfprobePath(): Promise<string> {
  if (!ffprobePathPromise) {
    ffprobePathPromise = import('ffmpeg-ffprobe-static')
      .then((mod) => {
        if (!mod.ffprobePath) throw new Error('ffprobe binary is unavailable on this platform')
        return ensureExecutableBinary(resolveUnpackedBinaryPath(mod.ffprobePath))
      })
      .catch((error) => {
        ffprobePathPromise = null
        throw error
      })
  }
  return ffprobePathPromise
}
