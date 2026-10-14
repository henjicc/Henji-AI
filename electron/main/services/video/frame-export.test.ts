import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('node:child_process', () => ({ spawn: (_binary: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, kill: vi.fn() })
  child.stdin.on('finish', () => { fs.writeFileSync(args.at(-1)!, 'encoded-output'); child.exitCode = 0; child.emit('close', 0) })
  return child
} }))
vi.mock('../image/path-utils', () => ({ getUploadsDir: () => fixture.directory, sanitizeFileStem: (stem: string) => stem, ensureOutputPathWithExtension: (file: string) => file }))
vi.mock('./ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'process-boundary' }))
vi.mock('./hwaccel', () => ({ getPreferredEncoder: async () => ({ id: 'cpu', label: 'CPU' }) }))
vi.mock('../work-root/busy-probes', () => ({ registerWorkRootBusyProbe: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { videoFrameExportFilterArgs, startVideoFrameExport, appendVideoFrameExport, finishVideoFrameExport } from './frame-export'
beforeEach(async () => { fixture.directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'henji-frame-export-copy-')) })
afterEach(async () => { await fs.promises.rm(fixture.directory, { recursive: true, force: true }) })
it('原有 MP4 默认底向上保持；GIF 顶向下和逐帧调色板不缓存整段画面', () => {
  expect(videoFrameExportFilterArgs({}, ['-c:v', 'libx264'])).toEqual(['-vf', 'vflip,scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264'])
  expect(videoFrameExportFilterArgs({ format: 'gif', orientation: 'top-down' }, [])).toEqual(['-filter_complex', 'split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1', '-c:v', 'gif'])
  expect(videoFrameExportFilterArgs({ format: 'gif' }, [])[1]).toMatch(/^vflip,/)
})
it.each(['mp4', 'gif'] as const)('%s 用户目标的发布契约：GIF 不覆盖；旧 MP4 保留选定目标覆盖行为', async format => {
  const target = path.join(fixture.directory, `selected.${format}`); await fs.promises.writeFile(target, 'original-file')
  const { sessionId } = await startVideoFrameExport({ format, frameCount: 1, fps: 10, width: 2, height: 2, fileNameStem: 'step' })
  await appendVideoFrameExport({ sessionId, frameIndex: 0, bytes: new Uint8Array(16) })
  const finish = finishVideoFrameExport({ sessionId, targetPath: target })
  if (format === 'gif') { await expect(finish).rejects.toThrow(); expect(await fs.promises.readFile(target, 'utf8')).toBe('original-file') }
  else { expect((await finish).savedPath).toBe(target); expect(await fs.promises.readFile(target, 'utf8')).toBe('encoded-output') }
})
