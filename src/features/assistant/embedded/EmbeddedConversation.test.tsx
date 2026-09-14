/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyEmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import { UiButton } from '@/components/ui'

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), snapshot: { value: {} }, models: vi.fn() }))
vi.mock('./controller', () => ({ useEmbeddedAgent: () => mocks.snapshot.value, reportEmbeddedAgentError: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ embeddedAgent: { prompt: mocks.prompt, models: mocks.models } }) }))
vi.mock('../hostContext/hostContext', () => ({ createHostContextSnapshot: () => ({ workspace: {}, project: {}, surface: {} }) }))
vi.mock('../conversation/useConversationAutoScroll', () => ({ useConversationAutoScroll: () => ({ scrollToBottom: vi.fn(), suspendFollowing: vi.fn() }) }))
vi.mock('../conversation/AssistantComposer', () => ({ AssistantComposer: ({ onSubmit, disabled }: { onSubmit(text: string, attachments: []): void; disabled: boolean }) =>
  <UiButton disabled={disabled} onClick={() => onSubmit('第一条消息', [])}>发送</UiButton> }))
import { EmbeddedConversation } from './EmbeddedConversation'

afterEach(() => { cleanup(); vi.clearAllMocks() })
it('首次发送不等待 IPC 或模型启动就出现气泡，只展示加载动画', async () => {
  mocks.snapshot.value = emptyEmbeddedAgentSnapshot()
  mocks.models.mockResolvedValue([{ providerId: 'test', modelId: 'test', inputModalities: [] }])
  let accepted!: () => void
  mocks.prompt.mockImplementation(() => new Promise<void>(resolve => { accepted = resolve }))
  const view = render(<EmbeddedConversation />)
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(screen.getByText('第一条消息')).toBeTruthy()
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText(/正在准备|正在启动/)).toBeNull()
  const id = mocks.prompt.mock.calls[0][0].clientMessageId
  mocks.snapshot.value = { ...emptyEmbeddedAgentSnapshot(), busy: true, sendingMessage: { id, text: '第一条消息' } }
  view.rerender(<EmbeddedConversation />)
  expect(screen.getAllByText('第一条消息')).toHaveLength(1)
  await act(async () => { accepted() })
  expect(screen.getAllByText('第一条消息')).toHaveLength(1)
})
