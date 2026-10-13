// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
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
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('无关 DOM 变更不提交渲染，同帧 resize/scroll 只测量一次，卸载取消待测量', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => frames.delete(handle))
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)) }
    const commits = vi.fn()
    const { container, unmount } = render(<><div data-onboarding-target="model" /><Profiler id="hints" onRender={commits}><OnboardingHints /></Profiler></>)
    await act(async () => { flush() })
    await act(async () => {})
    await act(async () => { flush() })
    commits.mockClear()
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    measure.mockClear()
    await act(async () => {
      for (let index = 0; index < 50; index += 1) container.append(document.createElement('span'))
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('scroll'))
    })
    await act(async () => { flush() })
    expect(measure).toHaveBeenCalledTimes(1)
    expect(commits).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('resize')) })
    unmount()
    expect(frames.size).toBe(0)
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
