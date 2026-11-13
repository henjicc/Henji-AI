import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createVideoEditDocument } from '../../../../src/core/videoEdit/document'
import { captureOptionsSchema, type CaptureManifest } from '../../../../src/core/screenRecording/capture'
import type { DocumentMeta } from '../../../../src/core/documents/types'
import { recordingDocumentSchema, type RecordingDocument } from '../../../../src/core/screenRecording/document'
import type { CaptureLogPage } from '../../../../src/core/captureLog/events'
import type { ClockAnchor } from '../../../../src/core/captureLog/clock'
import { RECORDING_TRACK_JOURNAL_FILE } from '../../../../src/core/screenRecording/trackJournal'
import { CaptureLogCollector } from '../../../../src/core/captureLog/collector'
import { RecordingEventStore } from './event-store'
import { wavHeader } from './wav-file'
import { pausedRecording } from './capture/native-timing.test-support'

const state = vi.hoisted(() => ({ saved: undefined as { meta: DocumentMeta; content: RecordingDocument } | undefined, save: vi.fn(), recover: vi.fn(), takenNames: new Set<string>() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }))
vi.mock('./capture/storage', () => ({ recoverCapture: state.recover, probeMediaDurationUs: vi.fn() }))
vi.mock('../documents/runtime', () => ({ getDocumentService: () => ({
  createDocument: async (input: { id: string; name: string; content: RecordingDocument }) => {
    if (state.takenNames.has(input.name)) throw new DocumentNameConflictError(input.name)
    state.saved = { meta: { id: input.id, kind: 'screen_recording', revision: 0, name: input.name } as DocumentMeta, content: structuredClone(input.content) }; return structuredClone(state.saved)
  }, markDocumentOpened: async () => undefined, readDocument: async () => structuredClone(state.saved), saveDocument: state.save,
}) }))
import { DocumentNameConflictError } from '../documents/errors'
import { RecordingSessionDocument, readRecordingEvents, recoverRecordingSession } from './session-document'
let directory: string, id: string, manifest: CaptureManifest
beforeEach(async () => {
  vi.clearAllMocks(); id = randomUUID(); directory = await mkdtemp(path.join(tmpdir(), 'recording-document-'))
  manifest = { version: 2, sessionId: id, backend: 'gfxcapture', cursorEmbedded: false, status: 'prepared', options: captureOptionsSchema.parse({ sourceId: 'screen:1:0', width: 1920, height: 1080, fps: 30, bitrate: 12000000 }), spans: [] }
  state.recover.mockImplementation(async (_directory: string, value?: CaptureManifest) => ({ manifest: value ?? manifest, files: (value ?? manifest).spans.map(span => ({ index: span.index, path: path.join(directory, span.file), monoUs: span.monoUs, durationUs: span.durationUs || 4_000_000 })), rejected: [], repaired: 0 }))
  state.save.mockImplementation(async ({ expectedRevision, content }: { expectedRevision: number; content: RecordingDocument }) => {
    expect(expectedRevision).toBe(state.saved!.meta.revision)
    await new Promise(resolve => setTimeout(resolve, 1))
    state.saved = { meta: { ...state.saved!.meta, revision: expectedRevision + 1 }, content: structuredClone(content) }; return structuredClone(state.saved)
  })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
async function setup(tracks: RecordingDocument['devices'] = { microphone: {}, systemAudio: false }) { return RecordingSessionDocument.create(id, 1000000, { name: '课程', tracks }, '显示器', manifest, directory) }
const anchor = (monoUs: number, segment: string, audioSample = 0): ClockAnchor => ({ monoUs, audioSample, audioSegmentRef: segment, audioRate: 48000, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 0 })
/** 与 Mediabunny 一样先写头再写数据；`finished: false` 模拟写到一半进程退出，头里的长度还是占位的 0。 */
async function writeWav(file: string, frames: number, finished = true): Promise<void> {
  const layout = { format: 'pcm' as const, channels: 1, sampleRate: 48000, bitsPerSample: 16, blockAlign: 2 }
  const header = wavHeader(layout, finished ? frames * 2 : 0), data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2)
  await writeFile(path.join(directory, file), Buffer.concat([finished ? header : Buffer.concat([header.subarray(0, 4), Buffer.alloc(4), header.subarray(8, 40), Buffer.alloc(4)]), data]))
}

it('会话名与已有文件重名时自动加序号，照常开录', async () => {
  state.takenNames = new Set(['课程', '课程 (2)'])
  try {
    await setup()
    expect(state.saved?.meta.name).toBe('课程 (3)')
  } finally { state.takenNames = new Set() }
})

it('两小时的事件页与声音分段在录制中不重写整份文档；停止时一次写全，读回顺序与内容不变', async () => {
  const document = await setup()
  manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 1_000_000, durationUs: 0, finalized: false })
  manifest.status = 'recording'
  await document.capture(manifest)
  const before = state.save.mock.calls.length
  // 两小时、每页约 2 秒：3600 页；麦克风每 5 秒一段：1440 段。
  for (let index = 0; index < 3600; index++) document.page({ seqSpan: [index * 256, index * 256 + 255], entries: index % 100 ? [] : [{ kind: 'mark', eventId: `m${index}`, monoUs: index * 2_000_000, note: '' }] } as unknown as CaptureLogPage, path.join(directory, `${index}.capture.json`), 1)
  for (let index = 0; index < 1440; index++) {
    const segment = randomUUID(), start = 1_000_000 + index * 5_000_000
    await document.track({ type: 'seal', kind: 'microphone', segment: { id: segment, file: `${segment}.wav`, monoSpanUs: [start, start + 5_000_000], sampleRate: 48000, channels: 1, units: 240000, latencyCompensationUs: 0, anchors: [anchor(start, segment)] } })
  }
  expect(state.save.mock.calls.length).toBe(before)
  const journal = await readFile(path.join(directory, RECORDING_TRACK_JOURNAL_FILE), 'utf8')
  expect(journal.trim().split('\n')).toHaveLength(1440)
  manifest.status = 'stopped'
  const summary = await document.finish(manifest)
  expect(state.save.mock.calls.length).toBe(before + 1)
  expect(summary).toMatchObject({ status: 'stopped', eventPages: 3600, tracks: { microphone: { segments: 1440 } } })
  const content = recordingDocumentSchema.parse(state.saved!.content)
  expect(content.eventPages).toHaveLength(3600); expect(content.eventPages.at(-1)?.firstSequence).toBe(3599 * 256)
  expect(content.markers).toHaveLength(36)
  expect(content.tracks?.tracks[0].segments).toHaveLength(1440)
  expect(content.media.find(media => media.kind === 'screen')).toMatchObject({ durationUs: 4_000_000 })
}, 120_000)
it('录制中读事件走内存里的页索引；停止后走文档，校验哈希与归属', async () => {
  const document = await setup(), store = new RecordingEventStore(directory)
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id }, sourceDigest: `sha256:${'b'.repeat(64)}`, originUs: 1000000, id: randomUUID }, async page => { document.page(page, await store.write(page)) }, () => {})
  collector.start(4000000); collector.record(4100000, { kind: 'mark', note: '重点' }); await collector.flush()
  expect((await readRecordingEvents(id, 0, 10, true, document.pageReferences())).events).toMatchObject([{ note: '重点' }])
  await collector.stop(4200000)
  manifest.status = 'stopped'; await document.finish(manifest)
  const first = await readRecordingEvents(id, 0, 2, false)
  expect(first.events.map(event => event.kind)).toEqual(['control', 'mark']); expect(first.nextOffset).toBe(2)
  await writeFile(state.saved!.content.eventPages[0].path, '{}')
  await expect(readRecordingEvents(id, 0, 10, false)).rejects.toThrow('校验')
})
it('应用崩溃后从页文件与轨道记录重建：界面退出时没封口的声音段按文件实际长度补回，声音拼成一条', async () => {
  const document = await setup(), store = new RecordingEventStore(directory)
  manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 1_000_000, durationUs: 0, finalized: false }); manifest.status = 'recording'
  await document.capture(manifest); await document.range('startUs', 1_000_000)
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id }, sourceDigest: `sha256:${'b'.repeat(64)}`, originUs: 1000000, id: randomUUID }, async page => { document.page(page, await store.write(page)) }, () => {})
  collector.start(2_000_000); collector.record(2_500_000, { kind: 'mark', note: '崩溃前' }); await collector.flush()
  const sealed = randomUUID(), open = randomUUID()
  await writeWav(`${sealed}.wav`, 48000); await writeWav(`${open}.wav`, 12000, false)
  await document.track({ type: 'open', kind: 'microphone', segment: { id: sealed, file: `${sealed}.wav`, monoStartUs: 1_000_000, sampleRate: 48000, channels: 1, latencyCompensationUs: 0, anchor: anchor(1_000_000, sealed) } })
  await document.track({ type: 'seal', kind: 'microphone', segment: { id: sealed, file: `${sealed}.wav`, monoSpanUs: [1_000_000, 2_000_000], sampleRate: 48000, channels: 1, units: 48000, latencyCompensationUs: 0, anchors: [anchor(1_000_000, sealed), anchor(2_000_000, sealed, 48000)] } })
  await document.track({ type: 'open', kind: 'microphone', segment: { id: open, file: `${open}.wav`, monoStartUs: 2_000_000, sampleRate: 48000, channels: 1, latencyCompensationUs: 0, anchor: anchor(2_000_000, open) } })
  // 半行：写到一半的最后一条记录被丢弃。
  await writeFile(path.join(directory, RECORDING_TRACK_JOURNAL_FILE), '{"version":1,"sessi', { flag: 'a' })
  // 停止已经写进画面清单，但收尾（补分段、拼声音）没做完就崩溃：文档不能先变成已结束，否则不会再被恢复。
  manifest.status = 'stopped'; await document.capture(manifest)
  expect(state.saved!.content).toMatchObject({ status: 'recording', eventPages: [], tracks: null })
  const result = await recoverRecordingSession(id, directory)
  const content = recordingDocumentSchema.parse(state.saved!.content)
  expect(content.status).toBe('interrupted')
  expect(content.markers).toMatchObject([{ note: '崩溃前' }])
  expect(content.tracks?.tracks[0].segments.map(segment => segment.monoSpanUs)).toEqual([[1_000_000, 2_000_000], [2_000_000, 2_250_000]])
  const audio = content.media.filter(media => media.kind === 'microphone')
  expect(audio).toHaveLength(1); expect(audio[0]).toMatchObject({ monoUs: 1_000_000, durationUs: 1_250_000 })
  expect(result.durationUs).toBe(4_000_000)
  // 再恢复一次结果相同。
  await recoverRecordingSession(id, directory)
  expect(recordingDocumentSchema.parse(state.saved!.content).media).toEqual(content.media)
})
it('早于轨道记录的旧录制（文档里存着轨道、没有 tracks.journal）照常恢复，轨道沿用文档', async () => {
  await setup()
  const segment = randomUUID()
  await writeWav(`${segment}.wav`, 24000)
  const tracks = { version: 1 as const, sessionId: id, originUs: 1000000, tracks: [{ kind: 'microphone' as const, segments: [{ id: segment, file: `${segment}.wav`, monoSpanUs: [1_000_000, 1_500_000] as [number, number], sampleRate: 48000, channels: 1, units: 24000, latencyCompensationUs: 0, anchors: [anchor(1_000_000, segment)] }], gaps: [], warnings: [] }] }
  state.saved!.content = { ...state.saved!.content, status: 'recording', tracks, media: [{ id: segment, kind: 'microphone', path: path.join(directory, `${segment}.wav`), monoUs: 1_000_000, durationUs: 500_000 }] }
  await recoverRecordingSession(id, directory)
  const content = recordingDocumentSchema.parse(state.saved!.content)
  expect(content.tracks).toEqual(tracks)
  expect(content.media).toMatchObject([{ kind: 'microphone', monoUs: 1_000_000, durationUs: 500_000 }])
})
it('保存失败向采集方传播，不报告成功', async () => {
  const document = await setup(); state.save.mockRejectedValueOnce(new Error('磁盘已满'))
  await expect(document.capture(manifest)).rejects.toThrow('磁盘已满')
  expect(state.saved!.meta.revision).toBe(0)
})
it('脚本调用落盘串行保留第一次快照，重复调用拒绝', async () => {
  const document = await setup(), baseline = createVideoEditDocument('第一次快照')
  const call = { callId: randomUUID(), operations: [{ target: { kind: 'video_edit.sequence' as const, id: `${baseline.id}:sequence` }, properties: { 'video_edit.sequence.name': '演示' } }] }
  await document.scriptCall(call, [{ documentId: baseline.id, content: baseline }])
  await document.scriptCall({ ...call, callId: randomUUID() }, [{ documentId: baseline.id, content: { ...baseline, name: '后续快照' } }])
  expect(state.saved!.content.scriptCapture.calls).toHaveLength(2)
  expect(state.saved!.content.scriptCapture.baselines).toEqual([{ documentId: baseline.id, content: baseline }])
  expect(() => document.scriptCall(call, [])).toThrow('重复')
})

it('停止收尾按事件时钟与恢复后画面第一帧统一暂停区间，画面、声音与事件扣掉同一段', async () => {
  const document = await setup({ systemAudio: false })
  await document.range('startUs', 1_500_000)
  await document.pause(4_000_000); await document.resume(6_300_000)
  await document.range('endUs', 10_000_000)
  document.page({ seqSpan: [0, 2], entries: [
    { kind: 'control', action: 'start', eventId: 'a', monoUs: 500_000 },
    { kind: 'control', action: 'pause', eventId: 'b', monoUs: 4_000_000 },
    { kind: 'control', action: 'resume', eventId: 'c', monoUs: 6_100_000 },
  ] } as unknown as CaptureLogPage, path.join(directory, '0.capture.json'), 1)
  manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 1_000_000, durationUs: 3_400_000, finalized: true }, { index: 1, file: 'screen-000001.mp4', monoUs: 6_000_000, durationUs: 4_200_000, finalized: true })
  manifest.status = 'stopped'
  await document.finish(manifest)
  // 事件时钟停了 2.1 秒；画面 6.0 秒恢复，暂停就是 3.9–6.0 秒。
  expect(state.saved!.content.pauses).toEqual([{ startUs: 3_900_000, endUs: 6_000_000 }])
})

it('原生采集录的连续画面文件：暂停区间按它的逐帧时刻表定（与事件时钟扣掉的、合并各段的同一组数），不再按分片第一帧猜', async () => {
  const document = await setup({ systemAudio: false })
  await document.range('startUs', 2_000_000)
  await document.pause(5_010_000); await document.resume(7_100_000)
  await document.range('endUs', 10_000_000)
  // 30 帧：第 0 帧在会话 2 秒，录 3 秒、暂停 60 格（2 秒）、再录 3 秒。
  await writeFile(path.join(directory, 'screen-000000.frames'), pausedRecording())
  manifest.spans.push({ index: 0, file: 'screen-000000.mp4', monoUs: 2_000_000, durationUs: 6_000_000, finalized: true })
  manifest.status = 'stopped'
  await document.finish(manifest)
  expect(state.saved!.content.pauses).toEqual([{ startUs: 5_000_000, endUs: 7_000_000 }])
  expect(state.saved!.content.media.filter(media => media.kind === 'screen')).toEqual([expect.objectContaining({ monoUs: 2_000_000, durationUs: 6_000_000 })])
})
