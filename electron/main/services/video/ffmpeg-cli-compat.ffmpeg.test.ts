import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { buildAudioEditConcatFilter, buildAudioEditRenderArgs } from '../audio-edit/export-render'
import { ffmpegFilterComplexFileArgs, loadFfmpegPath, loadFfprobePath } from './ffmpeg-loader'

/**
 * FFmpeg 命令行兼容层（任务 3.7，`npm run test:ffmpeg-cli`）：用真实随包二进制核对全仓拼接的 FFmpeg/ffprobe 参数。
 * 不进普通单测——需要已就绪的 FFmpeg（Windows 为 BtbN 9.0，`node scripts/video-decoder-ffmpeg.cjs ensure`；
 * 其他平台为 ffmpeg-ffprobe-static 6.1.2）。Windows 上两份都在，两条分发路径一起验证。
 */
const run = promisify(execFile)
const ROOT = process.cwd()
const SELF = 'electron/main/services/video/ffmpeg-cli-compat.ffmpeg.test.ts'

/** FFmpeg 7.0 弃用、8.0 起删除的命令行选项（实测 9.0.2 报 Unrecognized option）；以及 9.0 删除的旧 NVENC 选项。 */
const REMOVED_SINCE_FFMPEG_8 = ['filter_complex_script', 'filter_script', 'vsync', 'map_channel', 'psnr', 'qphist', 'absf', 'vbsf', 'adrift_threshold', '2pass', 'cbr', 'spatial_aq', 'temporal_aq']

/** 与 FFmpeg 无关、只是同文件里其他命令（tar、PowerShell、vswhere）的参数或字符串片段。 */
const OTHER_COMMAND_TOKENS: Record<string, string> = {
  C: 'tar -C', cf: 'tar -cf', czf: 'tar -czf', xf: 'tar -xf', xzf: 'tar -xzf',
  NoProfile: 'PowerShell', NonInteractive: 'PowerShell', Command: 'PowerShell',
  latest: 'vswhere', products: 'vswhere', requires: 'vswhere', property: 'vswhere',
  partial: '证据文件名后缀',
}

/** 按文件登记的 FFmpeg 选项例外：必须真实出现，避免例外过期后继续放行。 */
const FILE_EXCEPTIONS: Record<string, Record<string, string>> = {
  'electron/main/services/video/hwaccel.ts': { allow_sw: 'h264_videotoolbox 私有选项，只在 macOS 构建中存在' },
  'electron/main/services/video/ffmpeg-loader.ts': { filter_complex_script: '只对仍声明该选项的 6.1.2 使用（按选项列表判定）' },
  'electron/main/services/video/ffmpeg-loader.test.ts': { filter_complex_script: '旧写法分支的精确测试' },
}

const SCAN_ROOTS = ['electron', 'scripts', 'src', 'native/video-decoder/src']
const SKIP_DIRECTORIES = new Set(['node_modules', 'target', 'ffmpeg', 'out', 'dist', '.git'])

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) return SKIP_DIRECTORIES.has(entry.name) ? [] : sourceFiles(file)
    return /\.(?:[cm]?js|tsx?|rs)$/.test(entry.name) ? [file] : []
  })
}

/** 调用 FFmpeg/ffprobe 的源文件里全部写死的选项名（不含流说明符），记录出现位置。 */
function optionLiterals(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const file of SCAN_ROOTS.flatMap(sourceFiles)) {
    if (file === SELF) continue
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    if (!/ffmpeg|ffprobe/i.test(text)) continue
    for (const match of text.matchAll(/(['"`])-([A-Za-z][A-Za-z0-9_-]*)(?::[A-Za-z0-9]+)*\1/g)) {
      const files = found.get(match[2]) ?? new Set<string>()
      files.add(file)
      found.set(match[2], files)
    }
  }
  return found
}

/** `-h full` 中的全部选项名：主选项（行首 `-name`）与各组件 AVOption（两格缩进 `-name`）。 */
async function knownOptions(binary: string): Promise<Set<string>> {
  const { stdout } = await run(binary, ['-hide_banner', '-h', 'full'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const names = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(?:-| {2}-)([A-Za-z0-9_-]+)/.exec(line)
    if (match) names.add(match[1])
  }
  return names
}

interface Toolchain { label: string; ffmpeg: string; ffprobe: string; major: number }

async function toolchain(label: string, ffmpeg: string, ffprobe: string): Promise<Toolchain> {
  const { stdout } = await run(ffmpeg, ['-hide_banner', '-version'], { windowsHide: true })
  const major = Number(/^ffmpeg version n?(\d+)\./.exec(stdout)?.[1])
  if (!Number.isInteger(major)) throw new Error(`无法识别 ${ffmpeg} 的版本：${stdout.split(/\r?\n/)[0]}`)
  return { label, ffmpeg, ffprobe, major }
}

/** 当前平台分发的 CLI（主进程定位入口），以及非 Windows 分发的 ffmpeg-ffprobe-static（存在且不同才加入）。 */
async function toolchains(): Promise<Toolchain[]> {
  const shipped = await toolchain('当前平台随包', await loadFfmpegPath(), await loadFfprobePath())
  const statics = await import('ffmpeg-ffprobe-static')
  const legacy = statics.ffmpegPath && statics.ffprobePath && path.resolve(statics.ffmpegPath) !== path.resolve(shipped.ffmpeg) && existsSync(statics.ffmpegPath)
    ? await toolchain('ffmpeg-ffprobe-static', statics.ffmpegPath, statics.ffprobePath)
    : null
  if (process.platform === 'win32' && !legacy) throw new Error('Windows 上应同时具备非 Windows 分发的 ffmpeg-ffprobe-static（npm 依赖），才能验证 6.1 兼容路径')
  return legacy ? [shipped, legacy] : [shipped]
}

describe('FFmpeg 命令行选项兼容（任务 3.7）', () => {
  let chains: Toolchain[] = []
  let directory = ''
  const literals = optionLiterals()

  beforeAll(async () => {
    chains = await toolchains()
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-ffmpeg-cli-'))
  }, 60_000)
  afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })

  it('Windows 随包 CLI 是 FFmpeg 9', () => {
    if (process.platform === 'win32') expect(chains[0].major).toBe(9)
    expect(literals.size).toBeGreaterThan(50)
  })

  it('全仓 FFmpeg/ffprobe 调用不使用 FFmpeg 8 起删除的选项', () => {
    const offending = REMOVED_SINCE_FFMPEG_8.flatMap((name) => [...(literals.get(name) ?? [])]
      .filter((file) => !FILE_EXCEPTIONS[file]?.[name])
      .map((file) => `-${name} @ ${file}`))
    expect(offending).toEqual([])
  })

  it('例外登记仍然有效', () => {
    for (const [file, names] of Object.entries(FILE_EXCEPTIONS)) {
      for (const name of Object.keys(names)) expect(literals.get(name)?.has(file), `${file} 已不再使用 -${name}，删除例外`).toBe(true)
    }
  })

  it('删除清单与 FFmpeg 9 实际一致', async () => {
    for (const chain of chains.filter((item) => item.major >= 9)) {
      const known = await knownOptions(chain.ffmpeg)
      expect(REMOVED_SINCE_FFMPEG_8.filter((name) => known.has(name)), chain.label).toEqual([])
    }
  }, 60_000)

  it('全仓写死的每个选项名都被各分发版本的 ffmpeg 或 ffprobe 识别', async () => {
    for (const chain of chains) {
      const [ffmpegOptions, ffprobeOptions] = await Promise.all([knownOptions(chain.ffmpeg), knownOptions(chain.ffprobe)])
      const unknown = [...literals].flatMap(([name, files]) => {
        if (OTHER_COMMAND_TOKENS[name] || ffmpegOptions.has(name) || ffprobeOptions.has(name)) return []
        if (name.startsWith('no') && ffmpegOptions.has(name.slice(2))) return []
        return [...files].filter((file) => !FILE_EXCEPTIONS[file]?.[name]).map((file) => `-${name} @ ${file}`)
      })
      expect(unknown, `${chain.label} FFmpeg ${chain.major}`).toEqual([])
    }
  }, 120_000)

  it('口播剪辑导出：超出命令行长度的滤镜图从文件读取，按样本得到完整输出', async () => {
    for (const [index, chain] of chains.entries()) {
      const source = path.join(directory, `source-${index}.wav`)
      await run(chain.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-ac', '2', '-c:a', 'pcm_s16le', source], { windowsHide: true })
      const spans: AudioEditTimelineSpan[] = Array.from({ length: 400 }, (_item, span) => ({
        sourceStartFrame: span * 200, sourceEndFrame: span * 200 + 150, outputStartFrame: span * 150, outputEndFrame: span * 150 + 150, muted: span % 7 === 0,
      }))
      const graph = buildAudioEditConcatFilter(spans, '0:a:0')
      expect(graph.length).toBeGreaterThan(32_767)
      const script = path.join(directory, `graph-${index}.txt`)
      await fs.writeFile(script, graph, 'utf8')
      const output = path.join(directory, `edited-${index}.wav`)
      const args = await buildAudioEditRenderArgs(chain.ffmpeg, source, script, output)
      expect(args).toEqual(expect.arrayContaining(await ffmpegFilterComplexFileArgs(chain.ffmpeg, script)))
      expect(args.includes('-filter_complex_script'), chain.label).toBe(chain.major < 8)
      await run(chain.ffmpeg, args, { windowsHide: true })
      const { stdout } = await run(chain.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,duration_ts', '-of', 'json', output], { windowsHide: true })
      expect(JSON.parse(stdout).streams[0], chain.label).toMatchObject({ codec_name: 'pcm_s24le', sample_rate: '48000', channels: 2, duration_ts: 400 * 150 })
    }
  }, 120_000)
})
