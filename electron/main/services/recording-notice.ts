import { BrowserWindow, Notification, type WebContents } from 'electron'
import { createMainLogger } from './logging'

const logger = createMainLogger('main.recording_notice')
/** 显示中的系统通知：对象被回收后点击就没有回应，用户点过或关掉之前一直留着引用。 */
const shown = new Set<Notification>()

/**
 * 录音、录屏出了需要用户知道的事（意外中断、自动续录）：窗口最小化或在后台时界面里的提示看不到，
 * 发系统通知并闪任务栏，点通知回到窗口。窗口就在前台时界面已经显示，不再打扰。
 */
export function notifyRecording(contents: WebContents | null | undefined, title: string, body: string): void {
  try {
    const win = contents && !contents.isDestroyed() ? BrowserWindow.fromWebContents(contents) : null
    if (win && !win.isDestroyed() && win.isFocused() && win.isVisible() && !win.isMinimized()) return
    if (win && !win.isDestroyed()) win.flashFrame(true)
    logger.info('已发出录制提醒', { event: 'recording.notice.shown', context: { title, body } })
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body })
    const forget = (): void => { shown.delete(notification) }
    notification.on('click', () => { forget(); if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
    notification.on('close', forget)
    notification.on('failed', forget)
    shown.add(notification)
    notification.show()
  } catch (error) { logger.warn('录制提醒未能显示', { event: 'recording.notice.failed', error }) }
}
