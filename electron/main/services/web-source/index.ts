import { app, webContents } from 'electron'
import { WEB_SOURCE_CONTENT_CHANGED_CHANNEL } from '../../../../src/platform/contracts/videoFrameTypes'
import { createMainLogger } from '../logging/main-logger'
import { WebSourcePages } from './pages'

export { parseWebSourceCaptureRequest, parseWebSourceOpenRequest, parseWebSourcePath } from './pages'

let pages: WebSourcePages | null = null

/** 主进程唯一的网页来源服务；内容变化发给所有有界面的页面，没订阅的忽略。 */
export function getWebSourcePages(): WebSourcePages {
  if (pages) return pages
  const created = new WebSourcePages(createMainLogger('main.web_source'), change => {
    for (const contents of webContents.getAllWebContents()) if (!contents.isDestroyed() && !contents.isOffscreen()) contents.send(WEB_SOURCE_CONTENT_CHANGED_CHANNEL, change)
  })
  app.once('will-quit', () => created.dispose())
  pages = created
  return created
}
