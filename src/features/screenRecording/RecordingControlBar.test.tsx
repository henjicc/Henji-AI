// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import i18n from '@/i18n/config'
const fixture = vi.hoisted(() => ({ snapshot: null as RecordingControlSnapshot | null }))
vi.mock('@/hooks/useApplyRuntimeTheme', () => ({ useApplyRuntimeTheme: () => {} }))
vi.mock('@/platform', () => ({ getPlatform: () => ({ screenRecording: {
  snapshot: async () => fixture.snapshot, onChanged: () => () => {}, control: vi.fn(),
} }) }))
import RecordingControlBar from './RecordingControlBar'
beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
afterEach(cleanup)
it.each(['ready', 'recording', 'paused'] as const)('控制条 %s 状态只突出一个主动作，按钮同档且禁用有原因', async phase => {
  fixture.snapshot = { sessionId: '00000000-0000-4000-8000-000000000001', phase, countdown: 0, elapsedMs: 12000, microphoneLevel: null, busy: false, error: null, shortcutConflicts: [] }
  const { container } = render(<RecordingControlBar />)
  const primaryLabel = phase === 'ready' ? '开始录制' : '停止录制'
  await waitFor(() => expect(screen.getByRole('button', { name: primaryLabel }).getAttribute('data-variant')).toBe('primary'))
  expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1)
  expect([...container.querySelectorAll('button')].every(button => button.getAttribute('data-size') === 'sm')).toBe(true)
  const marker = screen.getByRole('button', { name: '添加标记' })
  if (phase !== 'recording') { expect(marker.getAttribute('aria-disabled')).toBe('true'); expect(marker.getAttribute('aria-describedby')).toBeTruthy() }
})
