import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ directory: '', render: vi.fn() }))
vi.mock('electron', () => ({ net: {}, shell: {} }))
vi.mock('./player/player', () => ({ WebRecordingPlayer: { open: () => ({ render: boundary.render }) } }))
vi.mock('./backupVideo', () => ({ BACKUP_VIDEO_FILE: 'backup.mp4', BACKUP_AUDIO_DIRECTORY: 'audio', WebRecordingBackupVideo: {}, mixWebRecordingBackupAudio: vi.fn() }))
vi.mock('./server', () => ({ WEB_REPLAY_PORT: 7891, WebReplayServer: class {} }))
vi.mock('./locations', () => ({ resolveWebRecordingDirectory: async () => boundary.directory }))
vi.mock('../documents/runtime', () => ({ getDocumentService: vi.fn() }))
vi.mock('../appPaths', () => ({ getUserFolderDir: () => boundary.directory }))

import { renderWebRecording } from './runtime'

const ids = ['4c4fd189-61bf-4408-afc0-751c8c9ede67', '7d1e0c55-5a8e-4f3b-9d55-1f7a3c2b9e10']
const ok = (): { output: string; frames: number; width: number; height: number; durationMs: number; issues: Array<{ t: number; kind: string; message: string }>; looseMatches: number; unusedCalls: number; locatorMisses: number } => ({ output: 'video.mp4', frames: 60, width: 10, height: 10, durationMs: 1000, issues: [], looseMatches: 0, unusedCalls: 0, locatorMisses: 0 })

beforeEach(async () => { boundary.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-runtime-render-')) })
afterEach(async () => {
  await fs.rm(boundary.directory, { recursive: true, force: true })
  boundary.render.mockReset()
})

it('几段同时请求重演时排队，一段渲完才开始下一段', async () => {
  let release!: () => void
  const first = new Promise<void>(resolve => { release = resolve })
  boundary.render.mockImplementationOnce(async () => { await first; return ok() }).mockImplementationOnce(async () => ok())
  const a = renderWebRecording({ recordingId: ids[0], fps: 60, longEdge: 3840 })
  const b = renderWebRecording({ recordingId: ids[1], textOnly: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(boundary.render).toHaveBeenCalledTimes(1)
  // 同一段在排队或渲染中不能再开一次
  await expect(renderWebRecording({ recordingId: ids[1] })).rejects.toThrow('正在重演')
  release()
  await a; await b
  expect(boundary.render).toHaveBeenCalledTimes(2)
  expect(boundary.render.mock.calls[1][0]).toMatchObject({ video: false })
})
