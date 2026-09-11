import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from '../window'
import { isTrustedMainRendererUrl } from './main-renderer-url'

/** 允许重建任务所有者的入口必须来自正式主窗口的顶层页面。 */
export function assertTrustedMainRenderer(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || owner !== getMainWindow() || owner.isDestroyed()
    || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Untrusted main renderer IPC sender')
  }
  if (!isTrustedMainRendererUrl(event.senderFrame.url)) {
    throw new Error('Untrusted main renderer IPC origin')
  }
}
