import fs from 'node:fs'
import path from 'node:path'

export const VIDEO_DECODER_EXECUTABLE_NAME = 'henji-video-decoder.exe'

export interface VideoDecoderPathContext {
  isPackaged: boolean
  resourcesPath: string
  cwd: string
  platform: NodeJS.Platform
  exists?: (candidate: string) => boolean
}

/**
 * 原生视频解码服务只在 Windows 提供（重要记录 005）。FFmpeg DLL 与可执行文件放在同一目录，
 * 由系统加载器按可执行文件目录找到：开发时由 `npm run build:video-decoder` 复制到 target 目录，
 * 打包时整目录放入 resources/video-decoder（分发配置在 3.3 落地）。
 */
export function videoDecoderExecutableCandidates(context: VideoDecoderPathContext): string[] {
  if (context.platform !== 'win32') return []
  if (context.isPackaged) {
    return [path.join(context.resourcesPath, 'resources', 'video-decoder', VIDEO_DECODER_EXECUTABLE_NAME)]
  }
  const target = path.join(context.cwd, 'native', 'video-decoder', 'target')
  return [
    path.join(target, 'release', VIDEO_DECODER_EXECUTABLE_NAME),
    path.join(target, 'debug', VIDEO_DECODER_EXECUTABLE_NAME),
  ]
}

export function resolveVideoDecoderExecutable(context: VideoDecoderPathContext): string | null {
  const exists = context.exists ?? fs.existsSync
  return videoDecoderExecutableCandidates(context).find((candidate) => exists(candidate)) ?? null
}
