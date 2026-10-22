import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AudioEditTimelineSpan } from '../../../../src/core/audioEdit/types'
import { applyAudioEditSpliceFade, buildAudioEditSpliceFades } from '../../../../src/core/audioEdit/spliceDeclick'
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
  'electron/main/services/audio-edit/speech-energy.ts': { inf: 'astats 返回的负无穷电平元数据，不是命令行参数' },
  'electron/main/services/video/hwaccel.ts': { allow_sw: 'h264_videotoolbox 私有选项，只在 macOS 构建中存在' },
  'electron/main/services/video/proxy.ts': { allow_sw: '代理在 macOS 用 h264_videotoolbox 时的私有选项，只在 macOS 构建中存在' },
  'electron/main/services/video/ffmpeg-loader.ts': { filter_complex_script: '只对仍声明该选项的 6.1.2 使用（按选项列表判定）' },
  'electron/main/services/video/ffmpeg-loader.test.ts': { filter_complex_script: '旧写法分支的精确测试' },
  'electron/main/services/audio-edit/render.test.ts': { filter_complex_script: '替身里模拟 ffmpegFilterComplexFileArgs 的旧写法返回值，实际参数由 ffmpeg-loader 按版本决定' },
  'electron/main/services/screen-recording/capture/process.ts': { e: 'Node 采集看护进程的脚本参数，不传给 FFmpeg' },
  'scripts/lib/uiInspectionSceneScreenCapture.cjs': { EncodedCommand: 'PowerShell 性能采样脚本参数，不传给 FFmpeg' },
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
      const graph = buildAudioEditConcatFilter(spans, '0:a:0', 48000)
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

  it('音频删除和静音拼接降低跳变，预览与真实导出逐样本一致且总采样数不变', async () => {
    for (const [index, chain] of chains.entries()) {
      for (const sampleRate of [48000, 44100]) {
        const source = path.join(directory, `splice-source-${index}-${sampleRate}.f32`)
        const input = Float32Array.from({ length: 6000 }, (_, i) => {
          const value = Math.floor(i / 2) < 1500 ? 0.75 : -0.5
          return i % 2 ? -value : value
        })
        await fs.writeFile(source, Buffer.from(input.buffer))
        const spans: AudioEditTimelineSpan[] = [
          { sourceStartFrame: 0, sourceEndFrame: 700, outputStartFrame: 0, outputEndFrame: 700 },
          { sourceStartFrame: 1600, sourceEndFrame: 2300, outputStartFrame: 700, outputEndFrame: 1400 },
          { sourceStartFrame: 2300, sourceEndFrame: 2500, outputStartFrame: 1400, outputEndFrame: 1600, muted: true },
          { sourceStartFrame: 2500, sourceEndFrame: 2800, outputStartFrame: 1600, outputEndFrame: 1900 },
          { sourceStartFrame: 2800, sourceEndFrame: 2900, outputStartFrame: 1900, outputEndFrame: 2000 },
          { sourceStartFrame: 2901, sourceEndFrame: 2902, outputStartFrame: 2000, outputEndFrame: 2001 },
          { sourceStartFrame: 2903, sourceEndFrame: 2906, outputStartFrame: 2001, outputEndFrame: 2004 },
        ]
        const script = path.join(directory, `splice-${index}-${sampleRate}.filter`)
        await fs.writeFile(script, buildAudioEditConcatFilter(spans, '0:a:0', sampleRate))
        const output = path.join(directory, `splice-${index}-${sampleRate}.wav`)
        await run(chain.ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', source,
          ...await ffmpegFilterComplexFileArgs(chain.ffmpeg, script), '-map', '[out]', '-c:a', 'pcm_f32le', output], { windowsHide: true })
        const { stdout } = await run(chain.ffmpeg, ['-v', 'error', '-i', output, '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'], { windowsHide: true, encoding: 'buffer' })
        const actual = Float32Array.from({ length: stdout.length / 4 }, (_, i) => stdout.readFloatLE(i * 4))
        const expected = new Float32Array(2004 * 2)
        const hardCut = new Float32Array(expected.length)
        const fades = buildAudioEditSpliceFades(spans, sampleRate)
        for (const [i, span] of spans.entries()) {
          const pcm = input.slice(span.sourceStartFrame * 2, span.sourceEndFrame * 2)
          if (span.muted) pcm.fill(0)
          hardCut.set(pcm, span.outputStartFrame * 2)
          expected.set(applyAudioEditSpliceFade(pcm, 2, 0, fades[i]), span.outputStartFrame * 2)
        }
        expect(actual.length, `${chain.label} ${sampleRate}Hz 采样数`).toBe(hardCut.length)
        let maxError = 0
        for (let i = 0; i < actual.length; i++) maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]))
        expect(maxError, `${chain.label} ${sampleRate}Hz 预览/导出误差`).toBeLessThan(1e-7)
        for (const seam of [700, 1400, 1600]) {
          const maxJump = (pcm: Float32Array): number => {
            let jump = 0
            for (let i = (seam - 250) * 2; i < (seam + 250) * 2; i++) jump = Math.max(jump, Math.abs(pcm[i] - pcm[i - 2]))
            return jump
          }
          expect(maxJump(actual)).toBeLessThan(0.004)
          expect(maxJump(actual)).toBeLessThan(maxJump(hardCut) / 100)
        }
        expect(actual.slice(0, 400 * 2)).toEqual(hardCut.slice(0, 400 * 2))
        expect(actual.slice(1880 * 2, 1920 * 2)).toEqual(hardCut.slice(1880 * 2, 1920 * 2))
        expect(actual.slice(-2)).toEqual(hardCut.slice(-2))
      }
    }
  }, 120_000)
})
