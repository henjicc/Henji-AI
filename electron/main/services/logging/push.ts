import { BrowserWindow } from 'electron'
import { writeLogEventsToFile } from './writer'
import type { MainLogEvent } from './types'

/** 渲染层订阅日志事件的 IPC 通道，preload 白名单需同步声明该通道。 */
export const LOG_EVENT_CHANNEL = 'henji://log-event'

export function pushLogEvents(events: MainLogEvent[]): void {
  if (events.length === 0) {
    return
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(LOG_EVENT_CHANNEL, events)
    }
  })
}

/**
 * 统一日志写入口：前端桥接事件（ipc/logging.ts）与主进程自身事件
 * （main-logger.ts 的 createMainLogger）都经过这里——先落盘，再推送渲染层，
 * 保证渲染层收到的实时事件与磁盘文件内容一致。
 */
export async function appendLogEvents(events: MainLogEvent[]): Promise<void> {
  if (events.length === 0) {
    return
  }

  await writeLogEventsToFile(events)
  pushLogEvents(events)
}
