// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  reset: vi.fn(),
  update: vi.fn(),
  openFile: vi.fn(),
}))

vi.mock('@/commands/assistant', () => ({
  getAssistantUserInstructions: mocks.get,
  resetAssistantUserInstructions: mocks.reset,
  updateAssistantUserInstructions: mocks.update,
  openAssistantUserInstructionsFile: mocks.openFile,
}))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import AgentUserInstructionsSection from './AgentUserInstructionsSection'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({ content: '回答尽量简洁' })
  mocks.reset.mockResolvedValue({ content: '' })
})
afterEach(cleanup)

describe('助手用户指令（5.6 第二批）', () => {
  it('“清空指令”先二次确认，取消不清空，确认后才清空', async () => {
    render(<AgentUserInstructionsSection />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce())
    const clear = await screen.findByRole('button', { name: '清空指令' })
    await waitFor(() => expect(clear.hasAttribute('disabled')).toBe(false))
    expect(clear.className).toContain('ui-btn-danger')

    fireEvent.click(clear)
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(mocks.reset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清空指令' }))
    fireEvent.click(await screen.findByRole('button', { name: '清空' }))
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledOnce())
  })

  it('读取失败的状态行用危险文字色，加载成功不再常驻实现说明', async () => {
    mocks.get.mockRejectedValueOnce(new Error('指令文件损坏'))
    const view = render(<AgentUserInstructionsSection />)
    const line = await screen.findByText('指令文件损坏')
    expect(line.className).toContain('text-danger-text')
    view.unmount()

    render(<AgentUserInstructionsSection />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('正在读取用户指令…')).toBeNull())
    expect(screen.queryByText(/主进程/)).toBeNull()
  })
})
