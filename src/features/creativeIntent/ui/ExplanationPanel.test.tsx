import i18n from '@/i18n/config'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TranscriptEntry } from '@/core/creativeIntent/schema'
import type { ExplanationReviewResult } from './ExplanationReview'
import { ExplanationPanel, type ExplanationPanelProps } from './ExplanationPanel'
import { useExplanationHasRecorded, useExplanationTranscript } from './explanationPresentation'

vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: TranscriptEntry[]; itemContent: (index: number, value: TranscriptEntry) => React.ReactNode }) => <div data-testid="virtual-paragraphs">{data.map((entry, index) => <div key={entry.eventId}>{itemContent(index, entry)}</div>)}</div> }))
beforeEach(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(cleanup)
afterEach(() => localStorage.clear())
it('模型外发先确认；取消不生成，项目授权且只执行一次', async () => {
  const onGenerate = vi.fn(async () => {}), confirm = vi.fn(async () => {})
  const prepareGeneration = vi.fn(async () => ({ paidDetails: { estimatedCny: null, dailySpentCny: 0, category: 'explanation' as const }, hasProject: true, cancel: vi.fn(async () => {}), modelName: '测试模型', imageCount: 3, confirm }))
  render(<ExplanationPanel {...props({ onGenerate, prepareGeneration })} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '生成候选' }))
  await screen.findByRole('dialog', { name: '发送讲解给 AI？' })
  expect(screen.getByText('将发送讲解文字和 3 张画面给 测试模型。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
  expect(confirm).not.toHaveBeenCalled(); expect(onGenerate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '生成候选' }))
  await screen.findByRole('dialog', { name: '发送讲解给 AI？' })
  fireEvent.click(screen.getByRole('button', { name: '本项目始终允许' })); fireEvent.click(screen.getByRole('button', { name: '本项目始终允许' }))
  await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce())
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(true)
})
it('本地整理和已同意的生成无需外发确认；异步预检切换讲解后不发送', async () => {
  let finish!: (value: undefined) => void
  const onGenerate = vi.fn(async () => {}), prepareGeneration = vi.fn(() => new Promise<undefined>(resolve => { finish = resolve }))
  const view = render(<ExplanationPanel {...props({ onGenerate, prepareGeneration, contextKey: 'first' })} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '生成候选' }))
  view.rerender(<ExplanationPanel {...props({ onGenerate, contextKey: 'second' })} />)
  await act(async () => { finish(undefined) })
  expect(onGenerate).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '生成候选' }))
  await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).toBeNull()
})
const entry: TranscriptEntry = { kind: 'transcript', eventId: 'entry', seq: 1, monoUs: 100000, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', utteranceId: 'sentence', wordId: 'word', text: '把这个放到那边', audioSegmentRef: 'audio', startSample: 1, endSample: 48000, monoSpanUs: [100000, 200000], timelineSpans: [], granularity: 'word', alignmentQuality: 'precise', source: 'asr' }
const result: ExplanationReviewResult = { resolution: { text: entry.text, mentions: [], issues: [], negated: false }, plan: { status: 'review', issues: [], protectedRefs: [], recordedOperationRefs: [], changes: Array.from({ length: 7 }, (_, index) => ({ targetRef: { kind: 'image_edit.layer', id: String(index), label: `图片${index}` }, property: 'position', before: [.1, .5], after: [.8, .5], expectedDigest: 'baseline' })) } }
function props(extra: Partial<ExplanationPanelProps> = {}): ExplanationPanelProps {
  return { entries: [entry], stage: 'reviewing', elapsedUs: 42000000, busy: false, loading: false, hasRecorded: true, onRead: async () => result, onBind: async () => {}, onError: vi.fn(), onRetry: vi.fn(), onStart: vi.fn(), onTranscribe: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), onGenerate: vi.fn(async () => {}), ...extra }
}
it('共享三段面板按对象动作显示摘要，前五行与折叠展开，不泄露坐标或内部原因', async () => {
  const onGenerate = vi.fn(async () => {})
  render(<ExplanationPanel {...props({ onGenerate })} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false))
  expect(screen.getByText('讲解 · 0:42')).toBeTruthy(); expect(screen.getByRole('button', { name: '删除讲解' })).toBeTruthy()
  expect(screen.queryByText('图片5 移到右侧')).toBeNull()
  fireEvent.click(screen.getByText('还有 2 处')); expect(screen.getByText('图片6 移到右侧')).toBeTruthy()
  fireEvent.click(screen.getByText('生成候选')); await waitFor(() => expect(onGenerate).toHaveBeenCalledWith([entry]))
  expect(document.body.textContent).not.toMatch(/%|位置 1|对象 1|上一页|下一页|候选更新|baseline/)
})
it('待确认只显示一行元信息，原因只在对应词的证据中出现一次', async () => {
  const unresolved: ExplanationReviewResult = { ...result, resolution: { ...result.resolution, mentions: [{ id: 'mention', text: '这个', slot: 'target', entry, entries: [entry], negated: false, candidates: [], issues: ['讲话时未确认实际呈现画面', '没有对应的作品内指向；菜单和时间线点击不能绑定对象'], confirmedByUser: false }] }, plan: { ...result.plan, status: 'blocked', changes: [], issues: ['没有对应的作品内指向'] } }
  render(<ExplanationPanel {...props({ onRead: async () => unresolved, onPick: vi.fn(async () => {}) })} />)
  await screen.findByText('还有 1 处需要确认')
  expect(document.body.textContent).not.toContain('讲话时未确认')
  fireEvent.click(screen.getByText('还有 1 处需要确认'))
  await screen.findByText('说这句时没有指向画面，请点选对象')
  expect(screen.getAllByText('说这句时没有指向画面，请点选对象')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '生成候选' }).parentElement?.title).toBe('请先确认讲解中的指向')
  fireEvent.click(screen.getByRole('button', { name: '查看「这个」的指向' }))
  expect(screen.queryByText('说这句时没有指向画面，请点选对象')).toBeNull()
  fireEvent.click(screen.getByText('还有 1 处需要确认'))
  await screen.findByText('说这句时没有指向画面，请点选对象')
})
it('超过两千词按段落虚拟化，短讲解自然滚动', async () => {
  const long = { ...entry, text: Array.from({ length: 2001 }, () => '词').join(' ') }
  render(<ExplanationPanel {...props({ entries: [long], onRead: async () => ({ ...result, resolution: { ...result.resolution, text: long.text } }) })} />)
  expect(screen.getByTestId('virtual-paragraphs')).toBeTruthy()
})
it('转写行提供不确定进度和取消，初次麦克风信息开始后消失', () => {
  const onCancel = vi.fn(), view = render(<ExplanationPanel {...props({ stage: undefined, entries: [], hasRecorded: false })} />)
  expect(screen.getByText('会使用麦克风，录音只存在本机，审阅后删除')).toBeTruthy()
  view.rerender(<ExplanationPanel {...props({ stage: 'transcribing', entries: [], onCancel })} />)
  expect(screen.queryByText('会使用麦克风，录音只存在本机，审阅后删除')).toBeNull()
  expect(screen.getByRole('progressbar', { name: '转写进度' })).toBeTruthy()
  fireEvent.click(screen.getByText('取消')); expect(onCancel).toHaveBeenCalledOnce()
})
it('内部分批读取无限词稿，换会话后拒绝迟到的旧批次', async () => {
  let finish!: (value: TranscriptEntry[]) => void
  const readPage = vi.fn().mockImplementationOnce(() => new Promise<TranscriptEntry[]>(resolve => { finish = resolve })).mockResolvedValue([])
  const onError = vi.fn()
  function Host({ session }: { session: string }): JSX.Element { const data = useExplanationTranscript(session, readPage, undefined, onError); return <div>{data.entries.map(entry => entry.text).join('')}</div> }
  const view = render(<Host session="old" />)
  view.rerender(<Host session="new" />)
  finish([entry]); await waitFor(() => expect(readPage).toHaveBeenCalledTimes(2))
  expect(document.body.textContent).not.toContain(entry.text); expect(onError).not.toHaveBeenCalled()
})
it('布局元数据不要求移动差异，已确认的否定只作为保护摘要', async () => {
  const ref = { kind: 'image_edit.layer', id: 'safe', label: '主图' }
  const layout: ExplanationReviewResult = { ...result, plan: { ...result.plan, changes: [], status: 'satisfied' }, layout: { targetRefs: [ref, { ...ref, id: 'b' }, { ...ref, id: 'c' }], action: 'distribute' } }
  render(<ExplanationPanel {...props({ onRead: async () => layout })} />)
  await screen.findByText('3 张图片 等距排列')
  expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false)
})
it('首次开始录制的提示跨宿主重开仍只显示一次，不保存私密正文', () => {
  function Host({ recorded }: { recorded: boolean }): JSX.Element { return <span>{useExplanationHasRecorded(recorded) ? '已录制' : '首次提示'}</span> }
  const first = render(<Host recorded={false} />)
  expect(screen.getByText('首次提示')).toBeTruthy()
  first.rerender(<Host recorded />); first.unmount()
  render(<Host recorded={false} />)
  expect(screen.getByText('已录制')).toBeTruthy(); expect(localStorage.getItem('henji-explanation-recorded')).toBe('true')
})
it('手动点选期间收起证据后，读回新绑定而不是段落预读缓存', async () => {
  const ref = { kind: 'image_edit.layer', id: 'safe', label: '主图' }
  const mention = { id: 'mention', text: '这个', slot: 'target' as const, entry, entries: [entry], negated: true, candidates: [], issues: [], confirmedByUser: false }
  let current: ExplanationReviewResult = { ...result, resolution: { ...result.resolution, negated: true, mentions: [mention] }, plan: { ...result.plan, changes: [], status: 'blocked' } }
  let finish!: () => void
  const onRead = vi.fn(async () => current)
  const onPick = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve }); current = { ...current, resolution: { ...current.resolution, mentions: [{ ...mention, confirmedByUser: true, selected: { targetRefs: [ref], point: [.5, .5], timeline: null, pointer: null, evidenceSeqs: [] } }] }, plan: { ...current.plan, status: 'satisfied', protectedRefs: [ref] } } })
  render(<ExplanationPanel {...props({ onRead, onPick })} />)
  await screen.findByText('还有 1 处需要确认')
  fireEvent.click(screen.getByRole('button', { name: '查看「这个」的指向' }))
  fireEvent.click(await screen.findByRole('radio', { name: '其他…' }))
  fireEvent.click(screen.getByRole('button', { name: '查看「这个」的指向' }))
  await act(async () => finish())
  await screen.findByLabelText('保护')
  expect(screen.queryByText('还有 1 处需要确认')).toBeNull()
  expect(onRead).toHaveBeenCalledTimes(3)
})


it('保存会话同意使审阅版本变化后仍执行生成，切换会话才作废', async () => {
  const onGenerate = vi.fn(async () => {}), onRead = async () => result
  const prepareGeneration = vi.fn(async () => ({ paidDetails: { estimatedCny: null, dailySpentCny: 0, category: 'explanation' as const }, hasProject: true, cancel: vi.fn(async () => {}), modelName: '模型', imageCount: 1, confirm: async () => {
    view.rerender(<ExplanationPanel {...props({ onRead, onGenerate, prepareGeneration, contextKey: 'session:2', generationKey: 'session' })} />)
  } }))
  const view = render(<ExplanationPanel {...props({ onRead, onGenerate, prepareGeneration, contextKey: 'session:1', generationKey: 'session' })} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '生成候选' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '生成候选' }))
  fireEvent.click(await screen.findByRole('button', { name: '本项目始终允许' }))
  await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce())
})
