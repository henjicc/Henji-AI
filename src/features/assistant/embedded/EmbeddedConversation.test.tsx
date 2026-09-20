/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { emptyEmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import { UiButton } from '@/components/ui'
import { toModelPromptText, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { openAssistant, useAssistantUiStore } from '../store/assistantUiStore'

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), snapshot: { value: {} }, models: vi.fn() }))
vi.mock('./controller', () => ({ useEmbeddedAgent: () => mocks.snapshot.value, reportEmbeddedAgentError: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ embeddedAgent: { prompt: mocks.prompt, models: mocks.models } }) }))
vi.mock('../../application-control/hostContext/hostContext', () => ({ createHostContextSnapshot: () => ({ workspace: {}, project: {}, surface: {} }) }))
vi.mock('../conversation/useConversationAutoScroll', () => ({ useConversationAutoScroll: () => ({ scrollToBottom: vi.fn(), suspendFollowing: vi.fn() }) }))
vi.mock('../conversation/AssistantComposer', () => ({ AssistantComposer: ({ onSubmit, disabled, value }: { onSubmit(text: string, attachments: []): void; disabled: boolean; value: PromptDocumentV1 }) =>
  <><div data-testid="draft">{toModelPromptText(value)}</div><UiButton disabled={disabled} onClick={() => onSubmit('第一条消息', [])}>发送</UiButton></> }))
import { EmbeddedConversation } from './EmbeddedConversation'

afterEach(() => { cleanup(); vi.clearAllMocks() })
beforeEach(() => {
  useAssistantUiStore.setState({ pendingGoal: null, pendingGoalOptions: null, embeddedAccess: 'read' })
  mocks.snapshot.value = emptyEmbeddedAgentSnapshot()
  mocks.models.mockResolvedValue([{ providerId: 'test', modelId: 'test', inputModalities: [] }])
  mocks.prompt.mockResolvedValue(undefined)
})
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

it('显式自动发送沿正式入口只提交一次，保留点击时上下文与现有权限', async () => {
  const context = JSON.stringify({ surface: { focusedRef: { kind: 'audio_edit.project', id: 'original' } } })
  openAssistant('请直接优化口播', { autoSend: true, context })
  render(<StrictMode><EmbeddedConversation /></StrictMode>)
  await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1))
  expect(mocks.prompt.mock.calls[0][0]).toMatchObject({ text: '请直接优化口播', context, access: 'read', delivery: 'wait', attachments: [] })
  expect(useAssistantUiStore.getState().pendingGoal).toBeNull()
})

it('未配置模型时保留指令为草稿并显示配置入口，不自动调用', async () => {
  mocks.models.mockResolvedValue([])
  openAssistant('请优化工程', { autoSend: true })
  render(<EmbeddedConversation />)
  await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('请优化工程'))
  expect(screen.getByRole('button', { name: '设置可调用工具的模型' })).toBeTruthy()
  expect(mocks.prompt).not.toHaveBeenCalled()
  expect(useAssistantUiStore.getState().pendingGoal).toBeNull()
})

it('普通诊断入口只填草稿，自动优化不清空已有草稿', async () => {
  openAssistant('诊断草稿')
  render(<EmbeddedConversation />)
  await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('诊断草稿'))
  expect(mocks.prompt).not.toHaveBeenCalled()
  act(() => openAssistant('执行优化', { autoSend: true }))
  await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('draft').textContent).toBe('诊断草稿')
})

it('自动发送失败不会循环重试或丢掉草稿', async () => {
  mocks.prompt.mockRejectedValue(new Error('断网'))
  openAssistant('原草稿')
  render(<EmbeddedConversation />)
  await waitFor(() => expect(screen.getByTestId('draft').textContent).toBe('原草稿'))
  act(() => openAssistant('执行优化', { autoSend: true }))
  await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('draft').textContent).toBe('原草稿')
  expect(useAssistantUiStore.getState().pendingGoal).toBeNull()
})
