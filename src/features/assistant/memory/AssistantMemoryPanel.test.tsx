// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SHARED_MEMORY_ID } from '@/core/assistant/memory'
const state = vi.hoisted(() => ({ content: '原偏好', revision: 1 }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ({ assistant: {
  getSharedMemory: async () => ({ ...state, enabled: true }),
  getMemoryState: async () => ({ settings: { enabled: true, defaultTtlDays: 90 }, candidates: [], memories: [{
    memoryId: 'assistant-shared-summary', content: state.content, scope: { type: 'global', id: null }, kind: 'preference', sourceLabel: '助手共享记忆', createdAt: new Date().toISOString(),
  }] }),
  updateSharedMemory: async (input: { content: string; expectedRevision: number }) => {
    if (input.expectedRevision !== state.revision) throw new Error('记忆已改变，请重新读取并合并。')
    state.content = input.content; state.revision++; return { ...state, enabled: true }
  },
} }) }))
import { AssistantMemoryPanel } from './AssistantMemoryPanel'
afterEach(cleanup)
it('编辑共享记忆使用打开面板时的版本，拒绝覆盖外部新内容', async () => {
  expect(SHARED_MEMORY_ID).toBe('assistant-shared-summary')
  render(<AssistantMemoryPanel />)
  await screen.findByText('原偏好')
  fireEvent.click(screen.getByTitle('编辑记忆'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '旧草稿' } })
  state.content = '外部新偏好'; state.revision++
  fireEvent.click(screen.getByTitle('保存修改'))
  await screen.findByText('记忆已改变，请重新读取并合并。')
  expect(state.content).toBe('外部新偏好')
})
