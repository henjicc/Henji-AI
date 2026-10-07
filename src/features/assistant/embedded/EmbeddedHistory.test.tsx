/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyEmbeddedAgentSnapshot, type EmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), snapshot: { value: {} as EmbeddedAgentSnapshot } }))
vi.mock('./controller', () => ({ useEmbeddedAgent: () => mocks.snapshot.value, reportEmbeddedAgentError: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ embeddedAgent: { sessions: mocks.sessions, openSession: vi.fn() } }) }))
import { EmbeddedHistory } from './EmbeddedHistory'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('自己发起的列表读取让主进程进入切换中时，不取消也不重读；当前对话标为选中', async () => {
  mocks.snapshot.value = { ...emptyEmbeddedAgentSnapshot(), sessionId: 'b' }
  let resolve!: (value: Array<{ id: string; title: string; updatedAt: string }>) => void
  mocks.sessions.mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<EmbeddedHistory visible onOpen={vi.fn()} />)
  expect(mocks.sessions).toHaveBeenCalledTimes(1)
  mocks.snapshot.value = { ...mocks.snapshot.value, busy: true, switching: true }
  view.rerender(<EmbeddedHistory visible onOpen={vi.fn()} />)
  resolve([{ id: 'a', title: '第一段', updatedAt: '2026-10-04T08:00:00Z' }, { id: 'b', title: '第二段', updatedAt: '2026-10-04T09:00:00Z' }])
  mocks.snapshot.value = { ...mocks.snapshot.value, busy: false, switching: undefined }
  view.rerender(<EmbeddedHistory visible onOpen={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('button', { name: /第二段/ }).getAttribute('aria-current')).toBe('true'))
  expect(mocks.sessions).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: /第一段/ }).getAttribute('aria-current')).toBeNull()
})

it('回复中不读取列表并提示先停止；回复结束后再读取', async () => {
  mocks.sessions.mockResolvedValue([])
  mocks.snapshot.value = { ...emptyEmbeddedAgentSnapshot(), busy: true }
  const view = render(<EmbeddedHistory visible onOpen={vi.fn()} />)
  expect(screen.getByText('请先停止当前回复，再打开其他对话。')).toBeTruthy()
  expect(mocks.sessions).not.toHaveBeenCalled()
  mocks.snapshot.value = { ...emptyEmbeddedAgentSnapshot() }
  view.rerender(<EmbeddedHistory visible onOpen={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('还没有保存的对话')).toBeTruthy())
  expect(mocks.sessions).toHaveBeenCalledTimes(1)
})
