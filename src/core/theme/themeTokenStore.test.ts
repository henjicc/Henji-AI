import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_THEME_SEED, THEME_PRESETS, deriveThemeTokens } from './themeEngine'
import { areThemeTokensEqual, createThemeTokenStore, getThemeTokens } from './themeTokenStore'

describe('themeTokenStore', () => {
  it('默认快照是石墨预设，且不可变', () => {
    const tokens = getThemeTokens()
    expect(areThemeTokensEqual(tokens, deriveThemeTokens(DEFAULT_THEME_SEED))).toBe(true)
    expect(Object.isFrozen(tokens)).toBe(true)
    expect(Object.isFrozen(tokens.colors)).toBe(true)
  })

  it('令牌变化时通知订阅者并更换快照引用；内容相同不通知、引用不变', () => {
    const store = createThemeTokenStore()
    const listener = vi.fn()
    store.subscribeThemeTokens(listener)
    const before = store.getThemeTokens()

    expect(store.publishThemeTokens(deriveThemeTokens(DEFAULT_THEME_SEED))).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getThemeTokens()).toBe(before)

    const paper = deriveThemeTokens(THEME_PRESETS.paper.seed)
    expect(store.publishThemeTokens(paper)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toBe(store.getThemeTokens())
    expect(store.getThemeTokens().colors.window).toBe(paper.colors.window)
    expect(store.getThemeTokens()).not.toBe(before)
  })

  it('取消订阅后不再通知；回调中取消订阅不影响本轮其它订阅者', () => {
    const store = createThemeTokenStore()
    const second = vi.fn()
    const unsubscribeFirst = store.subscribeThemeTokens(() => unsubscribeFirst())
    store.subscribeThemeTokens(second)
    store.publishThemeTokens(deriveThemeTokens(THEME_PRESETS.ocean.seed))
    expect(second).toHaveBeenCalledTimes(1)

    const third = vi.fn()
    const unsubscribeThird = store.subscribeThemeTokens(third)
    unsubscribeThird()
    store.publishThemeTokens(deriveThemeTokens(THEME_PRESETS.film.seed))
    expect(third).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('发布方后续修改传入对象不会影响已存快照', () => {
    const store = createThemeTokenStore()
    const paper = deriveThemeTokens(THEME_PRESETS.paper.seed)
    store.publishThemeTokens(paper)
    const window = paper.colors.window
    paper.colors.window = paper.colors.text1
    expect(store.getThemeTokens().colors.window).toBe(window)
  })
})
