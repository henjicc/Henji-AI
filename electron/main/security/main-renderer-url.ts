import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
