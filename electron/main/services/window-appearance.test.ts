import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_WINDOW_APPEARANCE,
  createWindowAppearanceStore,
  parseWindowAppearance,
  type WindowAppearanceStoreDeps,
} from './window-appearance'
import { APP_WINDOW_BACKGROUND_HEX } from '../../../src/core/theme/colorTokens'
import { THEME_PRESETS, deriveThemeTokens } from '../../../src/core/theme/themeEngine'

const PAPER = { windowBackground: deriveThemeTokens(THEME_PRESETS.paper.seed).colors.window, colorScheme: 'light' as const }
const DARK_HEX = APP_WINDOW_BACKGROUND_HEX

function createDeps(overrides: Partial<WindowAppearanceStoreDeps> = {}) {
  const windows = [
    { isDestroyed: () => false, setBackgroundColor: vi.fn() },
    { isDestroyed: () => true, setBackgroundColor: vi.fn() },
  ]
  const writes: string[] = []
  const deps: WindowAppearanceStoreDeps = {
    readFile: () => null,
    writeFile: async (content) => { writes.push(content) },
    listWindows: () => windows,
    logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  }
  return { deps, windows, writes }
}

describe('parseWindowAppearance（IPC 严格校验）', () => {
  it('接受 #RRGGBB 与 dark/light，底色统一为大写', () => {
    expect(parseWindowAppearance({ windowBackground: DARK_HEX.toLowerCase(), colorScheme: 'dark' })).toEqual({ windowBackground: DARK_HEX, colorScheme: 'dark' })
  })

  it.each([
    null,
    'x',
    [],
    {},
    { windowBackground: DARK_HEX },
    { windowBackground: DARK_HEX.slice(1), colorScheme: 'dark' },
    { windowBackground: 'rgb(0,0,0)', colorScheme: 'dark' },
    { windowBackground: DARK_HEX, colorScheme: 'sepia' },
    { windowBackground: DARK_HEX, colorScheme: 'dark', extra: 1 },
  ])('拒绝非法输入 %j', (input) => {
    expect(() => parseWindowAppearance(input)).toThrow()
  })
})

describe('createWindowAppearanceStore', () => {
  it('启动时同步读取缓存；缺失时用默认石墨底色', () => {
    expect(createWindowAppearanceStore(createDeps().deps).get()).toEqual(DEFAULT_WINDOW_APPEARANCE)
    const store = createWindowAppearanceStore(createDeps({ readFile: () => JSON.stringify(PAPER) }).deps)
    expect(store.getBackgroundColor()).toBe(PAPER.windowBackground)
  })

  it('缓存损坏时回落默认并记录告警，不阻断窗口创建', () => {
    const { deps } = createDeps({ readFile: () => '{broken' })
    expect(createWindowAppearanceStore(deps).get()).toEqual(DEFAULT_WINDOW_APPEARANCE)
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'window_appearance.load.failed' }))
  })

  it('变化时更新已打开窗口底色并持久化；相同值不重复写', async () => {
    const { deps, windows, writes } = createDeps()
    const store = createWindowAppearanceStore(deps)
    await expect(store.update(PAPER)).resolves.toBe(true)
    expect(windows[0].setBackgroundColor).toHaveBeenCalledWith(PAPER.windowBackground)
    expect(windows[1].setBackgroundColor).not.toHaveBeenCalled()
    expect(writes).toEqual([JSON.stringify(PAPER)])
    expect(store.get()).toEqual(PAPER)

    await expect(store.update({ ...PAPER })).resolves.toBe(false)
    expect(writes).toHaveLength(1)
  })

  it('连续更新按顺序写入，最后一次胜出', async () => {
    const { deps, writes } = createDeps({
      writeFile: async (content) => {
        await new Promise((resolve) => setTimeout(resolve, content.includes('light') ? 5 : 0))
        writes.push(content)
      },
    })
    const store = createWindowAppearanceStore(deps)
    await Promise.all([store.update(PAPER), store.update(DEFAULT_WINDOW_APPEARANCE)])
    expect(writes.map((item) => JSON.parse(item).colorScheme)).toEqual(['light', 'dark'])
  })

  it('持久化失败只记结构化错误日志，本次运行的窗口底色仍已更新', async () => {
    const { deps, windows } = createDeps({ writeFile: async () => { throw new Error('disk full') } })
    const store = createWindowAppearanceStore(deps)
    await expect(store.update(PAPER)).resolves.toBe(true)
    expect(windows[0].setBackgroundColor).toHaveBeenCalledWith(PAPER.windowBackground)
    expect(deps.logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'window_appearance.persist.failed' }))
  })
})
