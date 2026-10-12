// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { RecordingCollector } from '@/features/creativeIntent/recording/RecordingCollector'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { transcriptEventSchema } from '@/core/creativeIntent/schema'
import type { VideoEditInstance } from '../application/videoEditService'
import type { VideoExplanationState } from '../application/videoEditExplanation'
import { VideoEditExplanationControls } from './VideoEditExplanationControls'

const control = vi.hoisted(() => ({ state: undefined as VideoExplanationState | undefined, version: 0, listeners: new Set<() => void>(), read: vi.fn(), review: vi.fn(), start: vi.fn(), preflight: vi.fn(async () => {}), transcribe: vi.fn(), erase: vi.fn() }))
vi.mock('../application/videoEditExplanation', () => ({ videoExplanationState: () => control.state, videoExplanationRevision: () => control.version, subscribeVideoExplanation: (listener: () => void) => { control.listeners.add(listener); return () => control.listeners.delete(listener) }, readVideoExplanationPage: control.read, readVideoExplanationReview: control.review, correctVideoExplanationBinding: vi.fn(), pickVideoExplanationBinding: vi.fn(), startVideoExplanation: control.start, stopVideoExplanation: vi.fn(), pauseVideoExplanation: vi.fn(), resumeVideoExplanation: vi.fn(), preflightVideoExplanation: control.preflight, transcribeVideoExplanation: control.transcribe, eraseVideoExplanation: control.erase, cancelVideoExplanationTranscription: vi.fn(), clearTemporaryVideoExplanationAudio: vi.fn(async () => {}), retryVideoExplanationSave: vi.fn(), generateVideoExplanationCandidates: vi.fn(async () => {}) }))
vi.mock('../application/videoEditService', () => ({ subscribeVideoEditDomain: () => () => {}, subscribeVideoEditView: () => () => {}, videoEditDomainRevision: () => 0, videoEditViewRevision: () => 0 }))
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, value: unknown) => ReactNode }) => <div>{data.map((value, index) => <div key={index}>{itemContent(index, value)}</div>)}</div> }))
let root: Root | undefined, element: HTMLElement | undefined
const owner = { version: 0, document: { id: 'fixture-document', revision: 1 } } as unknown as VideoEditInstance
const onError = vi.fn()
afterEach(async () => { await act(async () => root?.unmount()); element?.remove(); root = undefined; owner.version = 0; control.state = undefined; control.listeners.clear(); vi.clearAllMocks() })
function state(id: string): VideoExplanationState {
  const collector = new RecordingCollector({ ...recordingFixtureSession(), id, state: 'reviewing' }, async () => {}, () => {})
  collector.session.pages = [{ resourceId: 'page', digest: `sha256:${'1'.repeat(64)}`, bytes: 1, count: 1, kind: 'transcript', monoSpanUs: [0, 1000], seqSpan: [0, 1] }]
  return { collector, originMs: 0, elapsedUs: 42000000, busy: false, erased: false, controller: new AbortController(), uncertaintyUs: [] }
}
const button = (text: string): HTMLButtonElement => Array.from(document.querySelectorAll('button')).find(button => button.textContent === text || button.getAttribute('aria-label') === text)!
async function mount(): Promise<void> {
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root!.render(<VideoEditExplanationControls owner={owner} onError={onError} />))
  await act(async () => button('录制讲解').click())
}
it('删除或换会话后清空私密词稿；旧异步批次不能复活', async () => {
  const entry = transcriptEventSchema.parse({ kind: 'transcript', eventId: 'event', seq: 1, monoUs: 0, timeline: null, unavailableReason: 'missing-presentation', clockSegmentRef: 'clock', utteranceId: 'utterance', text: 'PRIVATE transcript old', audioSegmentRef: 'audio', startSample: 0, endSample: 48, monoSpanUs: [0, 1000], timelineSpans: [], granularity: 'segment', alignmentQuality: 'unavailable', source: 'asr' })
  control.state = state('old-session'); control.read.mockResolvedValue([entry]); control.version = 0
  control.review.mockImplementation(async value => ({ resolution: { text: value.text, mentions: [], issues: [], negated: false }, plan: { changes: [], protectedRefs: [], issues: [], status: 'blocked', recordedOperationRefs: [] } }))
  await mount(); expect(document.body.textContent).toContain('PRIVATE transcript old')
  let finish!: (value: unknown[]) => void
  control.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await act(async () => { control.state = state('pending-session'); control.version++; control.listeners.forEach(listener => listener()) })
  await act(async () => { control.state = state('new-session'); control.read.mockResolvedValue([]); control.version++; control.listeners.forEach(listener => listener()) })
  await act(async () => finish([entry]))
  expect(document.body.textContent).not.toContain('PRIVATE'); expect(onError).not.toHaveBeenCalled()
  expect(document.querySelector('textarea')).toBeNull(); expect(document.body.textContent).not.toMatch(/上一页|下一页|位置 1|对象 1/)
})
it('原音失效且无词稿时提供开始录制，初次提示不重复出现', async () => {
  control.state = state('expired'); control.state.collector.session.state = 'recoverable'; control.state.collector.session.retentionStatus = 'deleted'; control.state.collector.session.pages = []
  control.read.mockResolvedValue([])
  control.start.mockResolvedValue(undefined)
  await mount()
  expect(button('开始录制').disabled).toBe(false)
  await act(async () => button('开始录制').click())
  expect(control.start).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain('继续录制')
})
it('录制计时位于命令带，暂停与结束保持图标按钮，面板自动收起', async () => {
  control.state = state('recording'); control.state.collector.session.state = 'recording'; control.state.collector.session.pages = []
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  await act(async () => root!.render(<VideoEditExplanationControls owner={owner} onError={onError} />))
  expect(button('录制讲解').textContent).toBe('0:42')
  expect(button('暂停录制讲解')).toBeTruthy(); expect(button('结束录制讲解')).toBeTruthy()
  expect(document.querySelector('[aria-label="讲解词稿审阅"]')).toBeNull()
})
it('失败只给一句标题，重试执行刚才失败的操作', async () => {
  control.start.mockRejectedValueOnce(new Error('internal microphone cause')).mockResolvedValue(undefined)
  await mount()
  await act(async () => button('开始录制').click())
  expect(document.body.textContent).toContain('录制失败'); expect(document.body.textContent).not.toContain('internal microphone cause')
  await act(async () => button('重试').click())
  expect(control.start).toHaveBeenCalledTimes(2)
})

it('转写重试读取当前恢复状态，不按首次闭包重复新建转写请求', async () => {
  control.state = state('retry-asr'); control.read.mockResolvedValue([])
  control.transcribe.mockImplementationOnce(async () => { control.state!.collector.session.state = 'recoverable'; throw new Error('provider interrupted') }).mockResolvedValue(undefined)
  await mount()
  await act(async () => button('转写并审阅').click())
  await act(async () => button('同意上传并转写').click())
  expect(document.body.textContent).toContain('转写失败')
  await act(async () => button('重试').click())
  expect(control.transcribe).toHaveBeenCalledTimes(2)
  expect(control.transcribe.mock.calls[0][2]).toBe(false); expect(control.transcribe.mock.calls[1][2]).toBe(true)
})
it('私密绑定更新只递增宿主版本时，也刷新审阅摘要', async () => {
  const entry = transcriptEventSchema.parse({ kind: 'transcript', eventId: 'event', seq: 1, monoUs: 0, timeline: null, unavailableReason: 'static', clockSegmentRef: 'clock', utteranceId: 'utterance', text: '移动这个', audioSegmentRef: 'audio', startSample: 0, endSample: 48, monoSpanUs: [0, 1000], timelineSpans: [], granularity: 'segment', alignmentQuality: 'unavailable', source: 'asr' })
  control.state = state('binding-session'); control.read.mockResolvedValue([entry])
  control.review.mockImplementation(async () => ({ resolution: { text: entry.text, mentions: [], issues: [], negated: false }, plan: { changes: [{ targetRef: { kind: 'video_edit.clip', id: 'clip', label: owner.version ? '确认后的画面' : '确认前的画面' }, property: 'position', before: [.1, .5], after: [.8, .5], expectedDigest: 'digest' }], protectedRefs: [], issues: [], status: 'review', recordedOperationRefs: [] } }))
  await mount(); expect(document.body.textContent).toContain('确认前的画面')
  await act(async () => { owner.version++; control.version++; control.listeners.forEach(listener => listener()) })
  expect(owner.document.revision).toBe(1)
  expect(document.body.textContent).toContain('确认后的画面'); expect(document.body.textContent).not.toContain('确认前的画面')
})
it('确认删除先收起词稿，资源移除后的宿主通知不再读已删除页', async () => {
  const entry = transcriptEventSchema.parse({ kind: 'transcript', eventId: 'event', seq: 1, monoUs: 0, timeline: null, unavailableReason: 'static', clockSegmentRef: 'clock', utteranceId: 'utterance', text: '删除前的讲解', audioSegmentRef: 'audio', startSample: 0, endSample: 48, monoSpanUs: [0, 1000], timelineSpans: [], granularity: 'segment', alignmentQuality: 'unavailable', source: 'asr' })
  control.state = state('delete-session'); control.read.mockResolvedValue([entry])
  control.review.mockResolvedValue({ resolution: { text: entry.text, mentions: [], issues: [], negated: false }, plan: { changes: [], protectedRefs: [], issues: [], status: 'blocked', recordedOperationRefs: [] } })
  let finish!: () => void
  control.erase.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve }); owner.version++; control.version++; control.listeners.forEach(listener => listener()) })
  await mount(); await act(async () => button('删除讲解').click()); await act(async () => button('删除').click())
  expect(document.querySelector('[aria-label="讲解词稿审阅"]')).toBeNull()
  control.review.mockRejectedValue(new Error('讲解页缺失，请恢复原文件'))
  await act(async () => finish())
  expect(control.erase).toHaveBeenCalledOnce(); expect(control.review).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled()
})

it('转写预检失败不会打开付费确认或调用转写', async () => {
  control.state = state('preflight-session'); control.read.mockResolvedValue([])
  control.preflight.mockRejectedValueOnce(new Error('凭据未配置'))
  await mount(); await act(async () => button('转写并审阅').click())
  expect(document.body.textContent).toContain('转写预检失败')
  expect(button('同意上传并转写')).toBeUndefined(); expect(control.transcribe).not.toHaveBeenCalled()
})
