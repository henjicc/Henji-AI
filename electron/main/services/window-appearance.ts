import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'

import { APP_WINDOW_BACKGROUND_HEX } from '../../../src/core/theme/colorTokens'
import { createMainLogger, type MainLogger } from './logging/main-logger'

/**
 * 窗口外观（主题的 window 底色与 color-scheme）在主进程侧的唯一来源。
 *
 * 主题设置只存在渲染层；渲染层每次应用主题后经 `window:setAppearance` 同步过来。这里持有当前值、
 * 对已打开的窗口 `setBackgroundColor`、原子写入 userData 下的 `window-appearance.json`，
 * 下次启动时同步读出，供主窗口、日志窗口、剪辑弹出窗、3D 后台渲染窗创建时使用——
 * 这样纸白等浅色主题在窗口 ready-to-show 之前、缩放露底时也不会露出深色底。
 */

export type WindowColorScheme = 'dark' | 'light'

export interface WindowAppearance {
  windowBackground: string
  colorScheme: WindowColorScheme
}

export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = Object.freeze({
  windowBackground: APP_WINDOW_BACKGROUND_HEX,
  colorScheme: 'dark',
})

const WINDOW_APPEARANCE_FILE = 'window-appearance.json'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** 严格校验：只接受这两个字段，底色必须是 `#RRGGBB`，统一为大写。 */
export function parseWindowAppearance(input: unknown): WindowAppearance {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected window appearance to be an object')
  }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 2 || !keys.includes('windowBackground') || !keys.includes('colorScheme')) {
    throw new Error('Expected window appearance to contain exactly windowBackground and colorScheme')
  }
  const { windowBackground, colorScheme } = record
  if (typeof windowBackground !== 'string' || !HEX_COLOR.test(windowBackground)) {
    throw new Error('Expected windowBackground to be a #RRGGBB color')
  }
  if (colorScheme !== 'dark' && colorScheme !== 'light') {
    throw new Error('Expected colorScheme to be dark or light')
  }
  return { windowBackground: windowBackground.toUpperCase(), colorScheme }
}

export interface WindowAppearanceTarget {
  isDestroyed(): boolean
  setBackgroundColor(color: string): void
}

type WindowAppearanceLogger = Pick<MainLogger, 'warn' | 'error' | 'debug'>

export interface WindowAppearanceStoreDeps {
  /** 同步读缓存文件；不存在返回 null */
  readFile(): string | null
  writeFile(content: string): Promise<void>
  listWindows(): WindowAppearanceTarget[]
  logger: WindowAppearanceLogger
}

export interface WindowAppearanceStore {
  get(): WindowAppearance
  getBackgroundColor(): string
  /** 返回是否发生了变化；持久化失败只记日志，不影响本次运行中的窗口底色。 */
  update(next: WindowAppearance): Promise<boolean>
}

export function createWindowAppearanceStore(deps: WindowAppearanceStoreDeps): WindowAppearanceStore {
  let current: WindowAppearance | null = null
  let pendingWrite: Promise<void> = Promise.resolve()

  const load = (): WindowAppearance => {
    if (current) return current
    try {
      const raw = deps.readFile()
      current = raw ? parseWindowAppearance(JSON.parse(raw)) : DEFAULT_WINDOW_APPEARANCE
    } catch (error) {
      deps.logger.warn('窗口外观缓存无法读取，使用默认底色', { event: 'window_appearance.load.failed', error })
      current = DEFAULT_WINDOW_APPEARANCE
    }
    return current
  }

  return {
    get: load,
    getBackgroundColor: () => load().windowBackground,
    async update(next) {
      const previous = load()
      if (previous.windowBackground === next.windowBackground && previous.colorScheme === next.colorScheme) {
        return false
      }
      current = next
      for (const win of deps.listWindows()) {
        if (!win.isDestroyed()) win.setBackgroundColor(next.windowBackground)
      }
      const content = JSON.stringify(next)
      // 串行写：主题快速连续切换时保证最后一次写入胜出
      pendingWrite = pendingWrite.then(async () => {
        try {
          await deps.writeFile(content)
          deps.logger.debug('窗口外观已保存', { event: 'window_appearance.persist.completed', context: { ...next } })
        } catch (error) {
          deps.logger.error('窗口外观保存失败，下次启动将沿用上次保存的底色', {
            event: 'window_appearance.persist.failed',
            context: { ...next },
            error,
          })
        }
      })
      await pendingWrite
      return true
    },
  }
}

function appearanceFilePath(): string {
  return path.join(app.getPath('userData'), WINDOW_APPEARANCE_FILE)
}

/** 主进程默认实例（userData 随隔离测试资料一起隔离）。 */
export const windowAppearance: WindowAppearanceStore = createWindowAppearanceStore({
  readFile() {
    try {
      return fs.readFileSync(appearanceFilePath(), 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  },
  async writeFile(content) {
    const { writeBufferAtomically } = await import('./fs/atomic-file')
    await writeBufferAtomically(appearanceFilePath(), new TextEncoder().encode(content))
  },
  listWindows: () => BrowserWindow.getAllWindows(),
  logger: createMainLogger('main.window_appearance'),
})
