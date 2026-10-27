import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ directory: '', render: vi.fn() }))
vi.mock('electron', () => ({ net: {}, shell: {} }))
vi.mock('./player/player', () => ({ WebRecordingPlayer: { open: () => ({ render: boundary.render }) } }))
vi.mock('./backupVideo', () => ({ BACKUP_VIDEO_FILE: 'backup.mp4', BACKUP_AUDIO_DIRECTORY: 'audio', WebRecordingBackupVideo: {}, mixWebRecordingBackupAudio: vi.fn() }))
vi.mock('./server', () => ({ WEB_REPLAY_PORT: 7891, WebReplayServer: class {} }))
vi.mock('./locations', () => ({ resolveWebRecordingDirectory: async () => boundary.directory }))
vi.mock('../documents/runtime', () => ({ getDocumentService: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserFolderDir: () => boundary.directory }))

import { readWebRecording, renderWebRecording } from './runtime'
import { BOX_TRACK_FILE, BoxTrackWriter } from './boxTrack'
import { TEXT_TRACK_FILE, TextTrackWriter } from './textTrack'

afterEach(async () => {
  if (boundary.directory) await fs.rm(boundary.directory, { recursive: true, force: true })
  boundary.directory = ''
  boundary.render.mockReset()
})

it('正式读取服务路由 boxes 到真实文件；旧录制 data/behavior/text 不依赖 boxes', async () => {
  boundary.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-runtime-box-'))
  await fs.writeFile(path.join(boundary.directory, 'data.json'), JSON.stringify({ calls: [], callbacks: [], external: [], random: { math: [], uuid: [], bytes: [] }, clipboard: [] }))
  await fs.writeFile(path.join(boundary.directory, 'behavior.json'), JSON.stringify({ events: [{ kind: 'focus', t: 0, focused: true }] }))
  const text = new TextTrackWriter(path.join(boundary.directory, TEXT_TRACK_FILE))
  text.write(0, { width: 100, height: 100, items: [['hello', 10, 10, 20, 20]] })
  await text.close(1_000_000)
  const request = { recordingId: 'recording', offset: 0, limit: 10 }
  expect((await readWebRecording({ ...request, track: 'data' })).entries).toEqual([])
  expect((await readWebRecording({ ...request, track: 'behavior' })).entries).toHaveLength(1)
  expect((await readWebRecording({ ...request, track: 'text', query: 'hello' })).entries).toHaveLength(1)
  await expect(readWebRecording({ ...request, track: 'boxes' })).rejects.toThrow('textOnly=true')
  const writer = new BoxTrackWriter(path.join(boundary.directory, BOX_TRACK_FILE))
  await writer.write(0, { width: 100, height: 100, items: [['node-a', 10, 10, 20, 20], ['act:other#0', 30, 30, 10, 10]] })
  await writer.close(1_000_000)
  expect(await readWebRecording({ ...request, track: 'boxes', keyPrefix: 'node-', fromSeconds: 0.2, toSeconds: 0.8 })).toEqual({
    entries: [{ key: 'node-a', seconds: 0.2, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }], total: 1, nextOffset: null,
  })
})

it.each([false, true])('正式重演服务转发 selectors 与 fps（textOnly=%s）', async textOnly => {
  boundary.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-runtime-box-'))
  boundary.render.mockResolvedValue({ frames: 60 })
  await renderWebRecording({ recordingId: 'recording', fps: 60, textOnly, boxSelectors: ['.ask'] })
  expect(boundary.render).toHaveBeenCalledWith(expect.objectContaining({ fps: 60, boxSelectors: ['.ask'], textTrack: path.join(boundary.directory, TEXT_TRACK_FILE), ...(textOnly ? { video: false } : {}) }))
})

const manifestFixture = path.resolve('tests/fixtures/persistence/web-recording/v3.json')
const takeTracks = { behavior: [{ kind: 'text', t: 1000, data: 'a' }], timeMap: { version: 1, fps: 30, durationUs: 1_000_000, frames: 30, pieces: [], cuts: [], frameRecUs: [] }, steps: ['typewriter[0]（逐字打字）'] }

it('导演稿：校验不过（点名字段）一帧也不渲染；通过时出版本到 takes/，版本的轨道可按 take 读', async () => {
  boundary.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-runtime-take-'))
  await fs.copyFile(manifestFixture, path.join(boundary.directory, 'recording.json'))
  // 黄金样本录制长 15.7 秒
  const tooLate = await renderWebRecording({ recordingId: 'recording', director: { version: 1, timeline: { segments: [{ from: 50, to: 60 }] } } }).then(() => null, (error: Error) => error)
  expect(tooLate).toMatchObject({ name: 'WebReplayDirectorError', message: expect.stringContaining('timeline.segments[0].from：50 秒超出录制长度') })
  const badFile = path.join(boundary.directory, 'bad.json')
  await fs.writeFile(badFile, '{ version: 1')
  await expect(renderWebRecording({ recordingId: 'recording', directorFile: badFile })).rejects.toMatchObject({ name: 'WebReplayDirectorError', message: expect.stringContaining('directorFile：不是合法的 JSON') })
  expect(boundary.render).not.toHaveBeenCalled()

  boundary.render.mockImplementation(async (options: { output: string; boxTrack: string; textTrack: string }) => {
    await fs.writeFile(options.output, 'video')
    await fs.writeFile(options.boxTrack, '{"t":0,"width":100,"height":100,"items":[["node-a",10,10,20,20]]}\n{"t":1000000,"width":0,"height":0,"items":[]}\n')
    await fs.writeFile(options.textTrack, '')
    return { output: options.output, frames: 30, width: 100, height: 100, durationMs: 1000, issues: [], looseMatches: 0, unusedCalls: 0, locatorMisses: 0, takeTracks }
  })
  const file = path.join(boundary.directory, 'director.json')
  await fs.writeFile(file, JSON.stringify({ version: 1, typewriter: [{ at: 1 }] }))
  const result = await renderWebRecording({ recordingId: 'recording', directorFile: file, take: '首问', fps: 30 })
  const take = path.join(boundary.directory, 'takes', '首问')
  expect(result).toMatchObject({ output: path.join(take, 'video.mp4'), take: { name: '首问', directory: take, frames: 30, durationMs: 1000, steps: takeTracks.steps } })
  expect(boundary.render).toHaveBeenCalledWith(expect.objectContaining({ director: { version: 1, typewriter: [{ at: 1, charsPerSecond: 12, jitter: 0.3 }] }, pointer: false }))
  // 录制本身的位置轨没有被写
  await expect(fs.access(path.join(boundary.directory, BOX_TRACK_FILE))).rejects.toThrow()
  const request = { recordingId: 'recording', offset: 0, limit: 10, take: '首问' }
  expect((await readWebRecording({ ...request, track: 'behavior' })).entries).toEqual(takeTracks.behavior)
  expect((await readWebRecording({ ...request, track: 'boxes' })).entries).toEqual([{ key: 'node-a', seconds: 0, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }, { key: 'node-a', seconds: 1, rect: null }])
  await expect(readWebRecording({ ...request, track: 'timemap', take: '没有' })).rejects.toThrow('没有叫“没有”的版本')
})
