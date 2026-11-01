import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WEB_RECORDING_MIN_READER_VERSION, WEB_RECORDING_VERSION } from '../../../../src/core/webReplay/schema'
import { RecordingEventStore } from '../screen-recording/event-store'

const state = vi.hoisted(() => ({ directory: '', warn: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ warn: state.warn, error: state.error, info: state.info }) }))
vi.mock('../appPaths', () => ({ getUserFolderDir: () => state.directory }))
vi.mock('./locations', () => ({ resolveWebRecordingLocation: () => ({ directory: state.directory }) }))
vi.mock('./takes', () => ({ readWebReplayTake: vi.fn(), readWebReplayTakeBehavior: vi.fn(), TAKE_FILES: { behavior: 'behavior.json' } }))
vi.mock('./backupVideo', () => ({ BACKUP_VIDEO_FILE: 'backup.mp4', BACKUP_TIMING_FILE: 'backup.json' }))
vi.mock('../video/ffmpeg-loader', () => ({ loadFfprobePath: () => 'fixture-ffprobe' }))
vi.mock('node:child_process', () => ({ execFile: (_file: string, _args: string[], _options: unknown, callback: (error: null, output: string) => void) => callback(null, JSON.stringify({ streams: [{ width: 1280, height: 720 }], format: { duration: '100' } })) }))

import { webRecordingEditSource } from './editSource'
import { WebRecordingStore } from './store'

const recordingId = '00000000-0000-4000-8000-000000000023'

beforeEach(async () => {
  const temporary = path.resolve('.tmp')
  await fs.mkdir(temporary, { recursive: true })
  state.directory = await fs.mkdtemp(path.join(temporary, 'web-edit-source-'))
  const store = new WebRecordingStore(state.directory)
  await store.writeManifest({
    version: WEB_RECORDING_VERSION, minReaderVersion: WEB_RECORDING_MIN_READER_VERSION,
    id: recordingId, status: 'complete', createdAt: '2026-11-02T00:00:00.000Z',
    app: { name: '测试网页', version: '1' }, probe: { version: '1', protocol: 1 }, host: 'web',
    env: { url: 'https://example.test/', viewport: { width: 1280, height: 720, dpr: 1 }, colorScheme: 'light', reducedMotion: false, locale: 'zh-CN', timeZone: 'Asia/Shanghai', userAgent: 'test' },
    wallAtZeroMs: 0, durationUs: 100_000_000, clock: null, fonts: [], warnings: [],
  })
  await store.writeBehavior([{ kind: 'pointer', t: 0, type: 'down', x: 100, y: 100, button: 0, buttons: 1, clickCount: 1, pointerType: 'mouse', mods: 0 }])
  await fs.writeFile(path.join(state.directory, 'replay-fixture.clean.mp4'), '')
  vi.clearAllMocks()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(state.directory, { recursive: true, force: true })
})

it('导入超过四页事件时等待落盘，完整保存且不误报录制积压，再次导入复用同一批页', async () => {
  const write = vi.spyOn(RecordingEventStore.prototype, 'write')
  const result = await webRecordingEditSource(recordingId)
  expect(result.cursor!.pages.length).toBeGreaterThanOrEqual(4)
  expect(result.events).toHaveLength(1)
  const pages = []
  for await (const page of new RecordingEventStore(path.dirname(result.cursor!.pages[0].path)).recover()) pages.push(page)
  expect(pages.flatMap(page => page.entries).filter(event => event.kind === 'cursor')).toHaveLength(1250)
  expect(state.warn).not.toHaveBeenCalled()
  expect(state.error).not.toHaveBeenCalled()
  write.mockClear()
  expect((await webRecordingEditSource(recordingId)).cursor).toEqual(result.cursor)
  expect(write).not.toHaveBeenCalled()
})

it('导入写盘失败时拒绝返回成功，报告保存失败而不是要求暂停录制', async () => {
  vi.spyOn(RecordingEventStore.prototype, 'write').mockRejectedValue(new Error('disk full'))
  await expect(webRecordingEditSource(recordingId)).rejects.toThrow('disk full')
  expect(state.warn).not.toHaveBeenCalled()
  expect(state.error).toHaveBeenCalledOnce()
  expect(state.error.mock.calls[0][1]).toMatchObject({ event: 'web_replay.edit_source.failed', error: 'Error: disk full' })
  expect(state.info).not.toHaveBeenCalled()
})

it('写到中途失败后重试：不复用缺尾页的目录，重新生成完整的一批页', async () => {
  const original = RecordingEventStore.prototype.write
  let calls = 0
  vi.spyOn(RecordingEventStore.prototype, 'write').mockImplementation(async function (this: RecordingEventStore, ...args: Parameters<RecordingEventStore['write']>) {
    if (++calls === 3) throw new Error('disk full')
    return original.apply(this, args)
  })
  await expect(webRecordingEditSource(recordingId)).rejects.toThrow('disk full')
  vi.restoreAllMocks()
  const result = await webRecordingEditSource(recordingId)
  const pages = []
  for await (const page of new RecordingEventStore(path.dirname(result.cursor!.pages[0].path)).recover()) pages.push(page)
  expect(pages.flatMap(page => page.entries).filter(event => event.kind === 'cursor')).toHaveLength(1250)
})
