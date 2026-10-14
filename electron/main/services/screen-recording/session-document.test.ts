import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { captureOptionsSchema, type CaptureManifest } from '../../../../src/core/screenRecording/capture'
import type { DocumentMeta } from '../../../../src/core/documents/types'
import type { RecordingDocument } from '../../../../src/core/screenRecording/document'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import { RecordingEventStore } from './event-store'

const state = vi.hoisted(() => ({ saved: undefined as { meta: DocumentMeta; content: RecordingDocument } | undefined, save: vi.fn(), recover: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('./capture/storage', () => ({ recoverCapture: state.recover }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({
  createDocument: async (input: { id: string; name: string; content: RecordingDocument }) => {
    state.saved = { meta: { id: input.id, kind: 'screen_recording', revision: 0, name: input.name } as DocumentMeta, content: structuredClone(input.content) }; return structuredClone(state.saved)
  }, markDocumentOpened: async () => undefined, readDocument: async () => structuredClone(state.saved), saveDocument: state.save,
}) }))
import { RecordingSessionDocument, readRecordingEvents, recoverRecordingSession } from './session-document'
let directory: string, id: string, manifest: CaptureManifest
beforeEach(async () => {
  vi.clearAllMocks(); id = randomUUID(); directory = await mkdtemp(path.join(tmpdir(), 'recording-document-'))
  manifest = { version: 1, sessionId: id, backend: 'chromium', cursorEmbedded: true, status: 'prepared', options: captureOptionsSchema.parse({ sourceId: 'screen:1:0', width: 1920, height: 1080, fps: 30, bitrate: 12000000 }), spans: [] }
  state.save.mockImplementation(async ({ expectedRevision, content }: { expectedRevision: number; content: RecordingDocument }) => {
    expect(expectedRevision).toBe(state.saved!.meta.revision)
    await new Promise(resolve => setTimeout(resolve, 1))
    state.saved = { meta: { ...state.saved!.meta, revision: expectedRevision + 1 }, content: structuredClone(content) }; return structuredClone(state.saved)
  })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
async function setup() { return RecordingSessionDocument.create(id, 1000000, { name: '课程', tracks: { microphone: {}, systemAudio: false } }, '显示器', manifest, directory) }
it('并发屏幕与音轨检查点串行保存；错误时钟拒绝，停止完成前全部引用已落盘', async () => {
  const document = await setup()
  manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 3000000, durationUs: 1000000, finalized: true })
  manifest.status = 'stopped'
  await Promise.all([document.capture(manifest), document.tracks({ version: 1, sessionId: id, originUs: 1000000, tracks: [] })])
  expect(state.saved!.content).toMatchObject({ status: 'stopped', tracks: { originUs: 1000000 }, media: [{ path: path.join(directory, 'screen-000000.mp4') }] })
  expect(() => document.tracks({ version: 1, sessionId: randomUUID(), originUs: 1000000, tracks: [] })).toThrow('归属')
  expect(state.save).toHaveBeenCalledTimes(2)
})
it('分页读事件和标记校验哈希与归属；恢复只补已落盘页和可播放片段', async () => {
  const document = await setup(), store = new RecordingEventStore(directory)
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id }, sourceDigest: `sha256:${'b'.repeat(64)}`, originUs: 1000000, id: randomUUID }, async page => { await document.page(page, await store.write(page)) }, () => {})
  collector.start(4000000); collector.record(4100000, { kind: 'mark', note: '重点' }); await collector.stop(4200000)
  const first = await readRecordingEvents(id, 0, 2, false)
  expect(first.events.map(event => event.kind)).toEqual(['control', 'mark']); expect(first.nextOffset).toBe(2)
  expect((await readRecordingEvents(id, 2, 2, false)).events).toHaveLength(1)
  expect((await readRecordingEvents(id, 0, 10, true)).events).toMatchObject([{ note: '重点' }])
  const mediaPath = path.join(directory, 'recovered-0.mp4')
  state.recover.mockResolvedValue({ files: [{ path: mediaPath, monoUs: 3000000, durationUs: 200000 }] })
  await recoverRecordingSession(id, directory)
  expect(state.saved!.content).toMatchObject({ status: 'interrupted', media: [{ path: mediaPath }], markers: [{ note: '重点' }] })
  await writeFile(state.saved!.content.eventPages[0].path, '{}')
  await expect(readRecordingEvents(id, 0, 10, false)).rejects.toThrow('校验')
})
it('保存失败向采集方传播，不报告成功', async () => {
  const document = await setup(); state.save.mockRejectedValueOnce(new Error('磁盘已满'))
  await expect(document.capture(manifest)).rejects.toThrow('磁盘已满')
  expect(state.saved!.meta.revision).toBe(0)
})
