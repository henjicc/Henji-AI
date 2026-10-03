import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { constants as fsConstants, readFileSync } from 'node:fs'

/**
 * 主进程 FFmpeg CLI（缩略图、波形、压缩、帧导出、探测、硬件编码检测等）唯一定位入口。
 *
 * - Windows（重要记录 014）：与原生视频解码服务共用同一份 BtbN win64-gpl-shared 构建的
 *   ffmpeg.exe / ffprobe.exe。开发时读 `native/video-decoder/ffmpeg/current.json`（由
 *   `scripts/video-decoder-ffmpeg.cjs ensure` 写入）指向的包 bin 目录；打包时位于
 *   `resources/video-decoder/`（与 henji-video-decoder.exe 及其 DLL 同目录）。
 * - 其他平台：维持 `ffmpeg-ffprobe-static`（asarUnpack 后的真实路径）。
 */
export type MediaBinaryName = 'ffmpeg' | 'ffprobe'

export interface MediaBinaryContext {
  platform: NodeJS.Platform
  isPackaged: boolean
  resourcesPath: string
  cwd: string
  readText?: (file: string) => string | null
}

export const UNIFIED_FFMPEG_PACKAGED_SEGMENTS = ['resources', 'video-decoder'] as const
export const UNIFIED_FFMPEG_POINTER_SEGMENTS = ['native', 'video-decoder', 'ffmpeg', 'current.json'] as const

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Windows 统一 FFmpeg 的 CLI 所在目录；非 Windows 返回 null。开发环境指针缺失或损坏时抛出带修复方式的错误。
 */
export function unifiedFfmpegDirectory(context: MediaBinaryContext): string | null {
  if (context.platform !== 'win32') return null
  // 统一构建只服务 Windows：路径一律按 Windows 规则拼接与判定（盘符才算绝对路径），不随执行代码的宿主平台变化。
  const winPath = path.win32
  if (context.isPackaged) return winPath.join(context.resourcesPath, ...UNIFIED_FFMPEG_PACKAGED_SEGMENTS)
  const pointerPath = winPath.join(context.cwd, ...UNIFIED_FFMPEG_POINTER_SEGMENTS)
  const text = (context.readText ?? readTextOrNull)(pointerPath)
  const hint = '请运行 `node scripts/video-decoder-ffmpeg.cjs ensure`（或 `npm run prepare:media-binaries`）'
  if (text === null) throw new Error(`FFmpeg 尚未就绪：缺少 ${pointerPath}，${hint}`)
  let binDir: unknown
  try {
    binDir = (JSON.parse(text) as { binDir?: unknown }).binDir
  } catch {
    binDir = undefined
  }
  if (typeof binDir !== 'string' || !binDir || winPath.isAbsolute(binDir) || binDir.split(/[\\/]/).includes('..')) {
    throw new Error(`FFmpeg 定位指针无效：${pointerPath}，${hint}`)
  }
  return winPath.join(winPath.dirname(pointerPath), ...binDir.split('/'))
}

export function unifiedMediaBinaryPath(name: MediaBinaryName, context: MediaBinaryContext): string | null {
  const directory = unifiedFfmpegDirectory(context)
  return directory ? path.win32.join(directory, `${name}.exe`) : null
}

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

/** 运行环境：Electron 主进程按 app.isPackaged；Node（单元测试、脚本）一律按开发目录。 */
async function currentContext(): Promise<MediaBinaryContext> {
  let isPackaged = false
  if (process.versions.electron) {
    const electron = await import('electron')
    isPackaged = electron.app?.isPackaged ?? false
  }
  return { platform: process.platform, isPackaged, resourcesPath: process.resourcesPath ?? '', cwd: process.cwd() }
}

async function resolveMediaBinary(name: MediaBinaryName): Promise<string> {
  const unified = unifiedMediaBinaryPath(name, await currentContext())
  if (unified) {
    try {
      await fs.access(unified, fsConstants.F_OK)
    } catch {
      throw new Error(`FFmpeg 不可用：找不到 ${unified}。开发环境请运行 \`node scripts/video-decoder-ffmpeg.cjs ensure\`；安装包缺少该文件时请重新安装。`)
    }
    return unified
  }
  const mod = await import('ffmpeg-ffprobe-static')
  const raw = name === 'ffmpeg' ? mod.ffmpegPath : mod.ffprobePath
  if (!raw) throw new Error(`${name} binary is unavailable on this platform`)
  return ensureExecutableBinary(resolveUnpackedBinaryPath(raw))
}

export function loadFfmpegPath(): Promise<string> {
  if (!ffmpegPathPromise) {
    ffmpegPathPromise = resolveMediaBinary('ffmpeg').catch((error: unknown) => {
      ffmpegPathPromise = null
      throw error
    })
  }
  return ffmpegPathPromise
}

export function loadFfprobePath(): Promise<string> {
  if (!ffprobePathPromise) {
    ffprobePathPromise = resolveMediaBinary('ffprobe').catch((error: unknown) => {
      ffprobePathPromise = null
      throw error
    })
  }
  return ffprobePathPromise
}

const legacyFilterScriptSupport = new Map<string, Promise<boolean>>()

function readFfmpegOptionHelp(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['-hide_banner', '-h', 'long'], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`无法读取 FFmpeg 选项列表：${error.message}`))
      else resolve(stdout)
    })
  })
}

/**
 * 从文件读取复杂滤镜图的参数（任务 3.7）。滤镜图可能远超 Windows 32K 命令行上限，必须走文件。
 *
 * FFmpeg 7.0 起用通用的 `-/filter_complex <文件>`，8.0 删除了 `-filter_complex_script`；Windows 随包的是 9.0，
 * 非 Windows 仍是 ffmpeg-ffprobe-static 6.1.2，只认旧写法。按二进制自己的选项列表判定（每个路径只查一次），
 * 不按平台或版本号猜。
 */
export async function ffmpegFilterComplexFileArgs(binary: string, scriptPath: string, readHelp: (binary: string) => Promise<string> = readFfmpegOptionHelp): Promise<string[]> {
  let legacy = legacyFilterScriptSupport.get(binary)
  if (!legacy) {
    legacy = readHelp(binary).then((help) => /^-filter_complex_script\b/m.test(help))
    legacyFilterScriptSupport.set(binary, legacy)
    legacy.catch(() => legacyFilterScriptSupport.delete(binary))
  }
  return await legacy ? ['-filter_complex_script', scriptPath] : ['-/filter_complex', scriptPath]
}
