// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { createRecordingDocument, type RecordingDocument } from '@/core/screenRecording/document'
import { recordingProductInputSchema } from '@/core/application-control/domains/screenRecording/productCapability'

const state = vi.hoisted(() => ({ content: null as RecordingDocument | null, revision: 1, files: new Map<string, Uint8Array>(), frames: [] as number[], fail: false, dispose: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), block: null as (() => Promise<void>) | null }))
vi.mock('@/platform', () => ({ getPlatform: () => ({
  documents: { readDocument: async () => ({ meta: { kind: 'screen_recording', revision: state.revision, name: '教程', createdAt: Date.now() }, content: structuredClone(state.content) }) },
  system: { paths: { join: async (...parts: string[]) => parts.join('/'), appDirectories: async () => ({ folders: { exports: '/exports' } }) }, fs: {
    mkdir: async () => {}, exists: async () => true,
    writeFile: async (path: string, bytes: Uint8Array, options: { exclusive: boolean }) => { if (state.files.has(path) && options.exclusive) throw new Error('exists'); state.files.set(path, bytes.slice()) },
    readFile: async (path: string, options: { maxBytes: number }) => { if (options.maxBytes > 16 * 1024 * 1024) throw new Error('maxBytes 超过正式桥上限'); const bytes = state.files.get(path); if (!bytes) throw new Error('missing'); return bytes },
  } },
  video: { readVideoInfo: async () => ({ width: 640, height: 360, durationSeconds: 15 }), startFrameExport: async (input: unknown) => { state.prepare(input); return { sessionId: 'encoder' } }, appendFrameExport: async () => {}, cancelFrameExport: state.cancel, finishFrameExport: async ({ targetPath }: { targetPath: string }) => { state.files.set(targetPath, new TextEncoder().encode('GIF89atest')); return { savedPath: targetPath } } },
  logging: { listLogDates: async () => [], queryLogEvents: vi.fn() },
}) }))
vi.mock('@/features/audioEdit', () => ({ createAudioEditDraft: vi.fn(), flushAudioEditProject: vi.fn(), loadAudioEditProject: vi.fn(), transcribeAudioEdit: vi.fn() }))
vi.mock('@/features/documents', () => ({ defaultDocumentOperationChanges: { changed: vi.fn() } }))
vi.mock('@/features/videoEdit', () => ({
  inspectVideoEditMedia: async (path: string) => ({ id: crypto.randomUUID(), path, name: '屏幕', kind: 'video', width: 1920, height: 1080, durationSeconds: 20 }),
  waitVideoEditSmartRegions: async () => ({}), waitVideoEditTracking: async () => {}, videoEditTrackResults: () => ({}),
  VideoEditRenderSession: class {
    canvas = { convertToBlob: async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) }
    setSmartRegions(): void {} setTracks(): void {}
    async render(frame: number): Promise<void> { state.frames.push(frame); if (state.block) await state.block(); if (state.fail) throw new Error('精确帧解码失败') }
    dispose = state.dispose
  },
}))
import { exportRecordingProduct, recordingProductExport, cancelRecordingProductExport, recordingProductExports } from './recordingProductService'

beforeEach(() => {
  vi.clearAllMocks(); state.files.clear(); state.frames = []; state.fail = false; state.revision = 1; state.block = null
  const content = createRecordingDocument(); content.status = 'stopped'; content.sessionId = crypto.randomUUID()
  content.media = [{ id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 3e6, durationUs: 20e6 }]
  content.understanding.steps = [{ id: 'step', title: '打开项目', description: '说明', signal: 'start', eventIds: [], startUs: 3e6, endUs: 23e6 }]
  content.understanding.candidates = [{ id: 'mistake', kind: 'mistake', reason: '保留错误帧用于报告', status: 'accepted', startUs: 4e6, endUs: 5e6, eventIds: [] }]
  state.content = content
  vi.stubGlobal('OffscreenCanvas', class { getContext(): { drawImage: () => void; getImageData: () => { data: Uint8ClampedArray } } { return { drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(640 * 360 * 4) }) } } })
})
it('图文经正式编译与像素边界，独占写入并回读，两种文本文档与图片一致', async () => {
  const result = await exportRecordingProduct(state.content!.sessionId!, { product: 'steps' }, new AbortController().signal)
  expect(result.state).toBe('completed'); expect(result.verified).toBe(true)
  expect(result.files).toEqual(['step-001.png', 'steps.md', 'steps.html']); expect(state.frames).toEqual([300])
  const md = [...state.files].find(([path]) => path.endsWith('steps.md'))![1]
  expect(new TextDecoder().decode(md)).toContain('打开项目')
  expect(recordingProductExport(result.id)).toEqual(result); expect(state.content!.compositions).toEqual([])
  expect(state.dispose).toHaveBeenCalledOnce()
})
it('单步 GIF 有界取首段，不烤入无限长录制；图片方向明确', async () => {
  const result = await exportRecordingProduct(state.content!.sessionId!, { product: 'gif' }, new AbortController().signal)
  expect(result.verified).toBe(true); expect(result.warnings.join(' ')).toContain('15 秒')
  expect(state.prepare).toHaveBeenCalledWith(expect.objectContaining({ frameCount: 150, format: 'gif', orientation: 'top-down', fps: 10, width: 640 }))
  expect(state.frames[0]).toBe(0); expect(state.frames.at(-1)).toBe(447)
})
it('缺陷报告取最后真实帧；无日志关联不伪造日志', async () => {
  const result = await exportRecordingProduct(state.content!.sessionId!, { product: 'bug_report' }, new AbortController().signal)
  expect(state.frames).toEqual([599]); expect(result.files).toContain('report.md'); expect(result.warnings.join(' ')).toContain('未附日志')
})
it('解码失败停止，公开失败记录仍可读回且资源释放', async () => {
  state.fail = true
  await expect(exportRecordingProduct(state.content!.sessionId!, { product: 'steps' }, new AbortController().signal)).rejects.toThrow('精确帧')
  expect(recordingProductExports().at(-1)).toMatchObject({ state: 'failed', verified: false, files: [] })
  expect(state.dispose).toHaveBeenCalledOnce()
})
it('取消等待编码关闭；会话修改阻止后续写入，已完成输出保留', async () => {
  let resume!: () => void
  state.block = () => new Promise<void>(resolve => { resume = resolve })
  const running = exportRecordingProduct(state.content!.sessionId!, { product: 'gif' }, new AbortController().signal)
  await vi.waitFor(() => expect(state.frames.length).toBe(1))
  const id = recordingProductExports().at(-1)!.id
  const cancel = cancelRecordingProductExport(id); resume()
  expect((await running).state).toBe('cancelled'); await cancel
  expect(state.cancel).toHaveBeenCalledWith('encoder'); expect(state.dispose).toHaveBeenCalledOnce()
  state.block = async () => { state.revision++ }
  await expect(exportRecordingProduct(state.content!.sessionId!, { product: 'steps' }, new AbortController().signal)).rejects.toThrow('会话已改变')
})
it('公开输入拒绝路径及未声明字段，步骤选择限制来自唯一声明', () => {
  expect(recordingProductInputSchema.safeParse({ sessionRef: { kind: 'screen_recording.session', id: crypto.randomUUID() }, product: 'gif', path: '/unsafe' }).success).toBe(false)
})
it('准备期间已保留会话，拒绝同目标并发；后续步骤失败保留已发布图片', async () => {
  const first = exportRecordingProduct(state.content!.sessionId!, { product: 'gif' }, new AbortController().signal)
  await expect(exportRecordingProduct(state.content!.sessionId!, { product: 'steps' }, new AbortController().signal)).rejects.toThrow('正在导出')
  await first
  state.frames = []
  const step = state.content!.understanding.steps[0]
  state.content!.understanding.steps = [{ ...step, endUs: 13e6 }, { ...step, id: 'second', startUs: 13e6 }]
  state.block = async () => { if (state.frames.length === 2) state.fail = true }
  await expect(exportRecordingProduct(state.content!.sessionId!, { product: 'steps' }, new AbortController().signal)).rejects.toThrow('精确帧')
  expect(recordingProductExports().at(-1)).toMatchObject({ state: 'failed', files: ['step-001.png'], completedSteps: 1, verified: false })
})
