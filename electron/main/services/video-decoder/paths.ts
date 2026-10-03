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
  // 只服务 Windows：按 Windows 路径规则拼接，不随执行代码的宿主平台变化。
  const winPath = path.win32
  if (context.isPackaged) {
    return [winPath.join(context.resourcesPath, 'resources', 'video-decoder', VIDEO_DECODER_EXECUTABLE_NAME)]
  }
  const target = winPath.join(context.cwd, 'native', 'video-decoder', 'target')
  return [
    winPath.join(target, 'release', VIDEO_DECODER_EXECUTABLE_NAME),
    winPath.join(target, 'debug', VIDEO_DECODER_EXECUTABLE_NAME),
  ]
}

export function resolveVideoDecoderExecutable(context: VideoDecoderPathContext): string | null {
  const exists = context.exists ?? fs.existsSync
  return videoDecoderExecutableCandidates(context).find((candidate) => exists(candidate)) ?? null
}

/**
 * 开发诊断：`HENJI_VIDEO_DECODER_EXECUTABLE` 指定服务可执行文件，文件不存在时按“服务缺失”处理（`path: null`）。
 * 安装包不读取（不能让环境变量换掉随包服务）。未设置时返回 undefined，按正常路径查找。
 */
export function videoDecoderExecutableOverride(isPackaged: boolean, env: NodeJS.ProcessEnv, exists: (candidate: string) => boolean = fs.existsSync): { path: string | null } | undefined {
  const value = env.HENJI_VIDEO_DECODER_EXECUTABLE?.trim()
  if (isPackaged || !value) return undefined
  return { path: path.isAbsolute(value) && exists(value) ? value : null }
}

/** 开发诊断：`HENJI_VIDEO_DECODER_VRAM_BUDGET_MB` 缩小解码显存预算。安装包不读取；无效值忽略。 */
export function videoDecoderDiagnosticLimits(isPackaged: boolean, env: NodeJS.ProcessEnv): { vramBytes: number } | undefined {
  const value = Number(env.HENJI_VIDEO_DECODER_VRAM_BUDGET_MB)
  if (isPackaged || !Number.isInteger(value) || value < 1 || value > 1_048_576) return undefined
  return { vramBytes: value * 1024 * 1024 }
}
