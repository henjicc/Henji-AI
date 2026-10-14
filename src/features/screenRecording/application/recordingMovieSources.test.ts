import { expect, it, vi } from 'vitest'
import { CaptureLogCollector } from '@/core/captureLog/collector'
import type { CaptureLogPage } from '@/core/captureLog/events'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { recordingMovieCursorSources } from './recordingMovieSources'
import { getPlatform } from '@/platform'
vi.mock('@/platform', () => ({ getPlatform: vi.fn() }))
it('事件页真实哈希与双时钟映射，暂停后的原片零点不重复补偿暂停；损坏/归属错误拒绝', async () => {
  const document = createRecordingDocument(), pages: CaptureLogPage[] = [], bytes = new Map<string, Uint8Array>()
  document.sessionId = crypto.randomUUID()
  document.source = { name: '测试窗口', options: captureOptionsSchema.parse({ sourceId: 'window:1:0', width: 1920, height: 1080, fps: 30, bitrate: 12000000 }), cursorEmbedded: false }
  const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: document.sessionId }, sourceDigest: `sha256:${'a'.repeat(64)}`, originUs: 0, id: () => crypto.randomUUID() }, async page => { pages.push(page) }, error => { throw error })
  collector.start(3000000); collector.pause(5000000); collector.resume(8000000); await collector.stop(10000000)
  for (const [index, page] of pages.entries()) {
    const data = new TextEncoder().encode(JSON.stringify(page))
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('')
    const path = `/fixture/page-${index}-${hash}.capture.json`
    bytes.set(path, data); document.eventPages.push({ path, firstSequence: page.seqSpan[0], lastSequence: page.seqSpan[1] })
  }
  document.media = [{ id: 'before', kind: 'screen', path: '/before.mp4', monoUs: 3000000, durationUs: 2000000 }, { id: 'after', kind: 'screen', path: '/after.mp4', monoUs: 8000000, durationUs: 2000000 }]
  const readFile = vi.fn(async (path: string) => bytes.get(path)!)
  vi.mocked(getPlatform).mockReturnValue({ system: { fs: { readFile } } } as unknown as ReturnType<typeof getPlatform>)
  const result = await recordingMovieCursorSources(document, new AbortController().signal)
  expect(result.get('before')?.recordingStartUs).toBe(0)
  expect(result.get('after')?.recordingStartUs).toBe(2000001)
  expect(result.get('after')?.pages).toHaveLength(pages.length)
  document.sessionId = crypto.randomUUID()
  await expect(recordingMovieCursorSources(document, new AbortController().signal)).rejects.toThrow('归属')
  readFile.mockResolvedValue(new Uint8Array([1, 2, 3]))
  await expect(recordingMovieCursorSources(document, new AbortController().signal)).rejects.toThrow('校验失败')
})
