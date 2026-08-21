// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/components/Settings/hooks/useDataPath', () => ({
  useDataPath: () => ({
    currentPath: '/mock/default/Henji-AI',
    defaultPath: '/mock/default/Henji-AI',
    isMigrating: false,
    progress: { current: 0, total: 0, file: '' },
    showProgress: false,
    alert: { open: false, type: 'success', message: { key: '' } },
    conflict: { open: false, targetPath: '' },
    confirmResetOpen: false,
    selectDirectory: vi.fn(),
    openResetConfirm: vi.fn(),
    closeResetConfirm: vi.fn(),
    resolveConflict: vi.fn(),
    resetToDefault: vi.fn(),
    closeAlert: vi.fn(),
    closeConflict: vi.fn(),
  }),
}))

describe('OnboardingModal', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('从欢迎页走到供应商选择，并保存测试密钥但不触发生成', async () => {
    render(<OnboardingModal />)

    const languageButton = screen.getByRole('button', { name: '切换语言' })
    expect(languageButton.textContent).toContain('跟随系统')
    fireEvent.click(languageButton)
    fireEvent.click(screen.getByRole('option', { name: '简体中文' }))
    expect(localStorage.getItem('henji-language')).toBe('zh-CN')
    expect(languageButton.textContent).toContain('简体中文')

    fireEvent.click(screen.getByRole('button', { name: '开始设置' }))
    expect(screen.getByText('设置数据保存目录')).toBeTruthy()
    expect(screen.queryByText('界面语言')).toBeNull()
    expect(screen.getByDisplayValue('/mock/default/Henji-AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(screen.getByText('选择一个默认供应商')).toBeTruthy()
    const providerButtons = screen.getAllByRole('button')
      .filter((button) => ['KIE', 'APIMart', 'Fal.ai', '派欧云']
        .some((name) => button.textContent?.startsWith(name)))
      .map((button) => button.textContent?.match(/^(KIE|APIMart|Fal\.ai|派欧云)/)?.[0])
    expect(providerButtons).toEqual(['KIE', 'APIMart', 'Fal.ai', '派欧云'])
    expect(screen.getByText('推荐起步').className).toContain('bg-veil-faint')
    expect(screen.getByText(/但目前支持的模型相对较少/)).toBeTruthy()

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
