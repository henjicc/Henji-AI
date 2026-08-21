// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import { onboardingManager } from '../application/onboardingManager'
import { OnboardingHints } from './OnboardingHints'

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

describe('OnboardingHints', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 420,
      bottom: 462,
      left: 240,
      right: 440,
      width: 200,
      height: 42,
      x: 240,
      y: 420,
      toJSON: () => ({}),
    })
    onboardingManager.restart()
    onboardingManager.prepareFirstTask()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('依次聚焦模型、提示词和生成按钮，并允许结束应用内引导', async () => {
    render(
      <>
        <div data-onboarding-target="model" />
        <div data-onboarding-target="prompt" />
        <div data-onboarding-target="generate" />
        <OnboardingHints />
      </>,
    )

    expect(await screen.findByText('先选择一个模型')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('再确认你的提示词')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('点击这里开始生成')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '结束引导' }))
    expect(screen.queryByText('点击这里开始生成')).toBeNull()
  })
})
