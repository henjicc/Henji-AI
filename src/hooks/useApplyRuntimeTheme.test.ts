import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setAppearance, loggerError } = vi.hoisted(() => ({
  setAppearance: vi.fn<[unknown], Promise<void>>(),
  loggerError: vi.fn(),
}))

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => true,
  getPlatform: () => ({ window: { setAppearance } }),
}))
vi.mock('@/core/logging', () => ({
  createLogger: () => ({ error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { DEFAULT_THEME_SEED, THEME_PRESETS, deriveThemeTokens } from '@/core/theme/themeEngine'
import { resetWindowAppearanceSyncForTests, resolveDevelopmentThemeOverride, syncWindowAppearance } from './useApplyRuntimeTheme'

describe('开发启动主题预设', () => {
  it('只接受登记的预设，覆盖种子且不带用户覆盖', () => {
    expect(resolveDevelopmentThemeOverride('?henjiDevThemePreset=paper')).toEqual({ seed: THEME_PRESETS.paper.seed, overrides: {} })
    expect(resolveDevelopmentThemeOverride('?henjiDevThemePreset=sepia')).toBeNull()
    expect(resolveDevelopmentThemeOverride('')).toBeNull()
  })
})

describe('syncWindowAppearance', () => {
  beforeEach(() => {
    resetWindowAppearanceSyncForTests()
    setAppearance.mockReset()
    setAppearance.mockResolvedValue(undefined)
    loggerError.mockReset()
  })

  it('把 window 令牌与 color-scheme 发给主进程，相同外观不重复发送', async () => {
    const paper = deriveThemeTokens(THEME_PRESETS.paper.seed)
    await syncWindowAppearance(paper)
    await syncWindowAppearance(deriveThemeTokens({ ...THEME_PRESETS.paper.seed, accent: DEFAULT_THEME_SEED.accent }))
    expect(setAppearance).toHaveBeenCalledTimes(1)
    expect(setAppearance).toHaveBeenCalledWith({ windowBackground: paper.colors.window, colorScheme: 'light' })

    await syncWindowAppearance(deriveThemeTokens(DEFAULT_THEME_SEED))
    expect(setAppearance).toHaveBeenCalledTimes(2)
  })

  it('同步失败写结构化错误日志，且下次仍会重试', async () => {
    setAppearance.mockRejectedValueOnce(new Error('ipc down'))
    const tokens = deriveThemeTokens(THEME_PRESETS.ocean.seed)
    await syncWindowAppearance(tokens)
    expect(loggerError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'theme.window_appearance.sync.failed' }))
    await syncWindowAppearance(tokens)
    expect(setAppearance).toHaveBeenCalledTimes(2)
  })
})
