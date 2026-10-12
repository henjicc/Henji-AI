// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'

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

// 文案走 i18n（任务 5.8，B-39）：断言按中文界面
beforeAll(async () => {
  await i18n.changeLanguage('zh-CN')
})

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

  it('首次读取显示加载，失败显示统一错误，重试成功后恢复编辑器', async () => {
    let reject: (error: Error) => void = () => {}
    mocks.get.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
    render(<AgentUserInstructionsSection />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    reject(new Error('指令文件损坏'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('指令文件损坏').closest('[role="alert"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('textbox')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })
})
