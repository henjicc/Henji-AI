import type { PlatformRuntime } from '@/platform/contracts'
import type { ShellKind } from '@/platform/types'
import { createElectronPlatform } from '@/platform/adapters/electron'

declare global {
  interface Window {
    henjiNative?: DynamicValue
  }
}

export function detectShell(): ShellKind | null {
  if (typeof window === 'undefined') return null

  if (window.henjiNative) return 'electron'

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Electron\//.test(ua)) return 'electron'

  return null
}

export function isDesktopRuntime(): boolean {
  return detectShell() !== null
}

/** UI 巡检读取真实资料时只暂停隐式持久化，不替换或复制用户配置。 */
export function isUiInspectionReadOnly(): boolean {
  if (typeof window === 'undefined') return false
  const native = window.henjiNative as {
    runtimeInfo?: { uiInspectionReadOnly?: boolean }
  } | undefined
  return native?.runtimeInfo?.uiInspectionReadOnly === true
}

export interface HenjiRuntimeFeatureFlags {
  imageEditorV3: boolean
}

interface HenjiRuntimeInfoShape {
  featureFlags?: { imageEditorV3?: boolean }
}

/** V3 默认关闭，只允许宿主入口在明确运行时开关下切换。 */
export function isImageEditorV3Enabled(runtimeInfo?: HenjiRuntimeInfoShape): boolean {
  if (runtimeInfo) return runtimeInfo.featureFlags?.imageEditorV3 === true
  if (typeof window === 'undefined') return false
  const native = window.henjiNative as { runtimeInfo?: HenjiRuntimeInfoShape } | undefined
  return native?.runtimeInfo?.featureFlags?.imageEditorV3 === true
}

let cachedPlatform: PlatformRuntime | null = null
let cachedShell: ShellKind | null = null

export function getPlatform(): PlatformRuntime {
  const shell = detectShell()
  if (!shell) {
    throw new Error('Platform runtime is only available inside the Electron desktop shell')
  }

  if (cachedPlatform && cachedShell === shell) {
    return cachedPlatform
  }

  cachedPlatform = createElectronPlatform()
  cachedShell = shell
  return cachedPlatform
}
