import type { WebContents } from 'electron'

/** Chromium net::ERR_ABORTED：导航被取消（含 will-navigate 拦下），旧文档仍在。 */
const ERR_ABORTED = -3

/**
 * 页面的主文档被换掉时调用 listener：主帧跨文档导航提交（did-navigate），或提交成错误页
 * （did-fail-provisional-load，这种情况不发 did-navigate）。按页面持有的资源都应在这里释放。
 *
 * 不用 did-start-navigation / did-start-loading：导航开始后仍可能被 will-navigate 拦下，
 * 那时旧页面还在、还在用这些资源；同文档内的地址变化与子框架加载也不算换页。
 * 崩溃与销毁不在这里，调用方另外监听 render-process-gone / destroyed。
 */
export function onRendererDocumentReplaced(contents: WebContents, listener: () => void): () => void {
  const failed = (_event: Electron.Event, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame && errorCode !== ERR_ABORTED) listener()
  }
  contents.on('did-navigate', listener)
  contents.on('did-fail-provisional-load', failed)
  return () => {
    contents.off('did-navigate', listener)
    contents.off('did-fail-provisional-load', failed)
  }
}
