// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRecordingDocument } from '@/core/screenRecording/document'
import type { RecordingPrivacyPanelProps } from './RecordingPrivacyPanel'
import { RecordingSessionPrivacy } from './RecordingSessionPrivacy'
import i18n from '@/i18n/config'
const boundary = vi.hoisted(() => ({ execute: vi.fn(), read: vi.fn(), show: vi.fn() }))
vi.mock('@/features/application-control', () => ({ executeUiApplicationCapability: boundary.execute }))
vi.mock('./application/recordingUnderstandingService', () => ({ readRecordingUnderstanding: boundary.read }))
vi.mock('./application/recordingService', () => ({ showRecordingDocument: boundary.show }))
vi.mock('@/components/ui/UiVirtualList', () => ({ UiVirtualList: ({ data, renderItem }: { data: RecordingPrivacyPanelProps['privacy']['candidates']; renderItem: (item: RecordingPrivacyPanelProps['privacy']['candidates'][number]) => JSX.Element }) => <div>{data.map(item => <div key={item.id}>{renderItem(item)}</div>)}</div> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
beforeEach(async () => { await i18n.changeLanguage('zh-CN'); boundary.execute.mockResolvedValue({ ok: true }); boundary.show.mockResolvedValue(undefined) })
function fixture() {
  const recording = createRecordingDocument(); recording.sessionId = crypto.randomUUID(); recording.status = 'stopped'
  recording.understanding.privacy.candidates = [{ id: 'private', mediaId: 's', kind: 'email', hint: '邮箱', fingerprint: 'a'.repeat(64), startUs: 1000000, endUs: 2000000, status: 'pending', samples: [{ monoUs: 1000000, box: [.1, .2, .3, .1], confidence: 1 }] }]
  boundary.read.mockResolvedValue({ meta: { revision: 7 }, content: structuredClone(recording) })
  const onBusyChange = vi.fn(), onSeek = vi.fn()
  render(<RecordingSessionPrivacy recording={recording} originUs={0} disabled={false} onBusyChange={onBusyChange} onSeek={onSeek} />)
  return { recording, onBusyChange, onSeek }
}
it('会话确认走通用事务，保留完整理解结果与版本，保存后刷新；定位交给统一播放器', async () => {
  const { recording, onSeek, onBusyChange } = fixture()
  fireEvent.click(screen.getByRole('button', { name: '查看画面' })); expect(onSeek).toHaveBeenCalledWith(recording.understanding.privacy.candidates[0])
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await waitFor(() => expect(boundary.show).toHaveBeenCalledWith(recording.sessionId))
  expect(boundary.execute.mock.calls[0][0]).toMatchObject({ id: 'change_application_entities', expectedRevisions: { screen_recording: 7 }, input: { changes: [{ target: { kind: 'screen_recording.understanding', id: recording.sessionId }, properties: { 'screen_recording.understanding.result': { ...recording.understanding, privacy: { candidates: [{ ...recording.understanding.privacy.candidates[0], status: 'accepted' }], warnings: [] } } } }] } })
  expect(onBusyChange.mock.calls.map(c => c[0])).toEqual([true, false])
})
it('过期会话不覆盖新的候选；识别走已有能力且卸载取消', async () => {
  const { recording } = fixture()
  boundary.read.mockResolvedValueOnce({ meta: { revision: 8 }, content: { ...recording, understanding: { ...recording.understanding, warnings: ['外部更新'] } } })
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await screen.findByText('会话已修改，请重新打开后确认。'); expect(boundary.execute).not.toHaveBeenCalled()
  boundary.execute.mockImplementationOnce(() => new Promise(() => {}))
  fireEvent.click(screen.getByRole('button', { name: '查找敏感信息' }))
  await waitFor(() => expect(boundary.execute).toHaveBeenCalledOnce())
  expect(boundary.execute.mock.calls[0][0]).toMatchObject({ id: 'detect_screen_recording_sensitive_text', input: { sessionRef: { id: recording.sessionId } } })
  const signal = boundary.execute.mock.calls[0][1] as AbortSignal
  cleanup(); expect(signal.aborted).toBe(true)
})
