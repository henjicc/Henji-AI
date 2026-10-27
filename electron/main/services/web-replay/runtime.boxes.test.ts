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
