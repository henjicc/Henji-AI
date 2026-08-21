// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import {
  aiGetProviderApiKey,
  aiSetProviderApiKey,
  aiTestProviderConnection,
} from '@/commands/aiRuntime'
import { onboardingManager } from '../application/onboardingManager'
import { OnboardingModal } from './OnboardingModal'

vi.mock('@/commands/aiRuntime', () => ({
  aiGetProviderApiKey: vi.fn(),
  aiSetProviderApiKey: vi.fn(),
  aiTestProviderConnection: vi.fn(),
}))

vi.mock('@/platform/desktopApi', () => ({
  openExternal: vi.fn(),
}))

describe('OnboardingModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.mocked(aiGetProviderApiKey).mockResolvedValue(null)
    vi.mocked(aiSetProviderApiKey).mockResolvedValue()
    vi.mocked(aiTestProviderConnection).mockResolvedValue({
      providerId: 'fal',
      status: 'connected',
      verified: true,
      checkedAt: '2026-08-21T00:00:00.000Z',
      durationMs: 42,
      httpStatus: 200,
    })
    onboardingManager.restart()
  })

  it('从欢迎页走到供应商选择，并保存测试密钥但不触发生成', async () => {
    render(<OnboardingModal />)

    fireEvent.click(screen.getByRole('button', { name: '开始设置' }))
    expect(screen.getByText('先确认两个基础项')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByText('选择一个主供应商')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Fal.ai/ }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(await screen.findByText('安全保存 Fal.ai 密钥')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('粘贴 Fal.ai API 密钥'), {
      target: { value: 'fal-test-key' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))

    await waitFor(() => expect(aiSetProviderApiKey).toHaveBeenCalledWith('fal', 'fal-test-key'))
    expect(aiTestProviderConnection).toHaveBeenCalledWith('fal')
    expect(await screen.findByText('连接成功，密钥有效')).toBeTruthy()
    expect(screen.getByText('HTTP 状态：200')).toBeTruthy()
  })
})
