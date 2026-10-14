// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RecordingPrivacyPanel } from './RecordingPrivacyPanel'
import { privacyCandidateSchema } from '@/core/screenRecording/privacy'
import '@/i18n'
vi.mock('@/components/ui/UiVirtualList', () => ({ UiVirtualList: ({ data, renderItem }: { data: unknown[]; renderItem: (item: unknown) => JSX.Element }) => <div>{data.map((item, i) => <div key={i}>{renderItem(item)}</div>)}</div> }))
it('逐条/全部确认、忽略和定位只提交受控候选，不展示原文', () => {
  const candidate = privacyCandidateSchema.parse({ id: 'private-line', mediaId: 'screen', kind: 'email', hint: '••••', fingerprint: 'a'.repeat(64), startUs: 3000000, endUs: 3300000, status: 'pending', samples: [{ monoUs: 3000000, box: [.1, .2, .4, .1], confidence: .99 }] }), onChange = vi.fn(), onSeek = vi.fn()
  render(<RecordingPrivacyPanel privacy={{ candidates: [candidate], warnings: [] }} onAnalyze={vi.fn()} onCancel={vi.fn()} onChange={onChange} onSeek={onSeek} />)
  fireEvent.click(screen.getByRole('button', { name: /^(确认|Confirm)$/ })); expect(onChange.mock.calls[0][0].candidates[0].status).toBe('accepted')
  fireEvent.click(screen.getByRole('button', { name: /^(忽略|Ignore)$/ })); expect(onChange.mock.calls[1][0].candidates[0].status).toBe('rejected')
  fireEvent.click(screen.getByRole('button', { name: /^(全部确认|Confirm all)$/ })); expect(onChange.mock.calls[2][0].candidates[0].status).toBe('accepted')
  fireEvent.click(screen.getByRole('button', { name: /^(查看画面|View frame)$/ })); expect(onSeek).toHaveBeenCalledWith(candidate)
  expect(screen.queryByText(candidate.fingerprint)).toBeNull()
})
