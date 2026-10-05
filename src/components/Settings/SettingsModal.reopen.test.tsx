/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n/config'
import { useUiStore } from '@/stores/uiStore'
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'

vi.mock('./tabs/GeneralTab', () => ({ default: () => <div>general</div> }))
vi.mock('./tabs/ModelsTab', () => ({ default: () => <div>models</div> }))
vi.mock('./tabs/AssistantTab', () => ({ default: () => <div>assistant</div> }))
vi.mock('./tabs/InterfaceTab', () => ({ default: () => <div>interface</div> }))

import SettingsModal from './index'

describe('设置弹窗淡出期间再次打开（5.8）', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
    // jsdom 没有 ResizeObserver：设置内容区的滚动定位会用到，测试里只需要它存在
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('关闭动画的 180ms 内再点设置：取消收起，弹窗留着，不会在计时结束时被卸载', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()

    act(() => { screen.getAllByRole('button', { name: /关闭/ })[0].click() })
    // 收起中：对读屏隐藏
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull()

    act(() => { useUiStore.getState().openSettings() })
    act(() => { vi.advanceTimersByTime(UI_DIALOG_TRANSITION_MS * 3) })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
  })

  it('没有再次打开时照常在淡出后通知关闭', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    act(() => { screen.getAllByRole('button', { name: /关闭/ })[0].click() })
    act(() => { vi.advanceTimersByTime(UI_DIALOG_TRANSITION_MS + 1) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
