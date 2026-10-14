import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../documents/runtime', () => ({ getDocumentService: vi.fn() }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfmpegPath: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserFolderDir: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('./session-document', () => ({ readRecordingEvents: vi.fn() }))
import { quickExportArgs, quickExportAudioGraph, quickExportOutputUs, quickExportWindows } from './quick-export'
import { appendRecordingEventsBox, readRecordingEventsBox, type EmbeddedRecordingEvents } from './embedded-events'

const media = (id: string, kind: 'screen' | 'microphone', monoUs: number, durationUs: number, file = `${id}.mp4`) => ({ id, kind, path: file, monoUs, durationUs })

describe('快速模式保存视频', () => {
  it('画面分段首尾相接，暂停期间的事件不进入视频时间', () => {
    const windows = quickExportWindows([media('b', 'screen', 5_000_000, 1_000_000), media('a', 'screen', 1_000_000, 2_000_000), media('m', 'microphone', 1_000_000, 5_000_000)])
    expect(windows).toEqual([{ startUs: 1_000_000, endUs: 3_000_000, outputUs: 0 }, { startUs: 5_000_000, endUs: 6_000_000, outputUs: 2_000_000 }])
    expect(quickExportOutputUs(windows, 5_500_000)).toBe(2_500_000)
    expect(quickExportOutputUs(windows, 4_000_000)).toBeNull()
  })
  it('声音只取与画面重叠的部分，并放到对应的视频时间', () => {
    const windows = quickExportWindows([media('a', 'screen', 1_000_000, 2_000_000), media('b', 'screen', 5_000_000, 1_000_000)])
    const mix = quickExportAudioGraph([media('m', 'microphone', 0, 6_000_000, 'm.wav')], windows, 1)!
    expect(mix.graph).toContain('[1:a]atrim=start=1.000000:duration=2.000000,asetpts=PTS-STARTPTS,adelay=0:all=1[a0]')
    expect(mix.graph).toContain('[1:a]atrim=start=5.000000:duration=1.000000,asetpts=PTS-STARTPTS,adelay=2000:all=1[a1]')
    expect(mix.graph).toContain('[a0][a1]amix=inputs=2')
    expect(quickExportAudioGraph([], windows, 1)).toBeNull()
  })

  const binaries = (() => { try { return createRequire(import.meta.url)(path.resolve('scripts/lib/mediaBinaries.cjs')) as { ffmpegPath: string; ffprobePath: string } } catch { return null } })()
  const root = mkdtempSync(path.join(tmpdir(), 'quick-export-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  it.skipIf(!binaries)('真实 ffmpeg：两段画面拼接、声音混入、事件写进文件后仍是普通视频且能读回', async () => {
    const { ffmpegPath, ffprobePath } = binaries!
    const spans = [path.join(root, 'screen-000000.mp4'), path.join(root, 'screen-000001.mp4')]
    for (const file of spans) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-c:v', 'mpeg4', file], { windowsHide: true })
    const wav = path.join(root, 'mic.wav')
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', wav], { windowsHide: true })
    const list = path.join(root, 'list.txt')
    writeFileSync(list, spans.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n'))
    const windows = quickExportWindows([media('a', 'screen', 0, 1_000_000, spans[0]), media('b', 'screen', 2_000_000, 1_000_000, spans[1])])
    const output = path.join(root, 'out.mp4')
    execFileSync(ffmpegPath, quickExportArgs(list, [wav], quickExportAudioGraph([media('m', 'microphone', 0, 3_000_000, wav)], windows, 1), output), { windowsHide: true })
    const payload: EmbeddedRecordingEvents = { format: 'henji.recording-events', version: 1, video: { width: 320, height: 180, fps: 30, durationMs: 2000 }, cursorEmbedded: true,
      events: [[0, 'cursor', 10, 20, 'arrow'], [500, 'click', 10, 20, 'left', 'down'], [1500, 'mark', '重点']] }
    await appendRecordingEventsBox(output, payload)
    const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true }).toString())
    expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1)
    expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type).sort()).toEqual(['audio', 'video'])
    expect(await readRecordingEventsBox(output)).toEqual(payload)
    expect(await readRecordingEventsBox(spans[0])).toBeNull()
  }, 60_000)
})
