import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WebContents } from 'electron'
import { createMainLogger } from '../services/logging/main-logger'

const logger = createMainLogger('main.renderer-security')

export interface MainRendererUrlPolicy {
  developmentUrl?: string
  packagedEntryPath?: string
}

function withoutNavigationState(url: URL): string {
  url.hash = ''
  url.search = ''
  return url.href
}

/** 主窗口只信任配置的开发服务器 origin，或打包产物唯一的 renderer 入口文件。 */
export function isTrustedMainRendererUrl(
  candidate: string,
  policy: MainRendererUrlPolicy = {},
): boolean {
  try {
    const actual = new URL(candidate)
    const developmentUrl = policy.developmentUrl ?? process.env['ELECTRON_RENDERER_URL']
    if (developmentUrl) return actual.origin === new URL(developmentUrl).origin
    const entryPath = policy.packagedEntryPath
      ?? path.join(__dirname, '../renderer/index.html')
    return withoutNavigationState(actual) === withoutNavigationState(pathToFileURL(entryPath))
  } catch {
    return false
  }
}

type WindowOpenHandler = Parameters<WebContents['setWindowOpenHandler']>[0]

/** 所有携带应用 preload 的窗口共用来源边界；受控剪辑浮窗由主窗口显式放行。 */
export function installRendererNavigationGuards(
  contents: WebContents,
  label: string,
  handleWindowOpen?: (details: Parameters<WindowOpenHandler>[0]) => ReturnType<WindowOpenHandler> | null | undefined,
): void {
  contents.setWindowOpenHandler(details => handleWindowOpen?.(details) ?? { action: 'deny' })
  const guard = (event: Electron.Event, url: string): void => {
    if (isTrustedMainRendererUrl(url)) return
    event.preventDefault()
    logger.warn('已阻止窗口导航到非应用来源', {
      event: 'window.navigation.blocked',
      context: { window: label, protocol: (() => { try { return new URL(url).protocol } catch { return 'invalid' } })() },
    })
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', event => event.preventDefault())
}
