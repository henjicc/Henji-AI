import path from 'node:path'

/**
 * ffmpeg-static / ffprobe-static 导出的是基于 __dirname 算出来的二进制路径常量。
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

export function loadFfmpegPath(): Promise<string> {
  if (!ffmpegPathPromise) {
    ffmpegPathPromise = import('ffmpeg-static').then((mod) => {
      const raw = mod.default
      if (!raw) throw new Error('ffmpeg binary is unavailable on this platform')
      return resolveUnpackedBinaryPath(raw)
    })
  }
  return ffmpegPathPromise
}

export function loadFfprobePath(): Promise<string> {
  if (!ffprobePathPromise) {
    ffprobePathPromise = import('ffprobe-static').then((mod) => resolveUnpackedBinaryPath(mod.default.path))
  }
  return ffprobePathPromise
}
