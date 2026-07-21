import { BrowserWindow } from 'electron'
import { applyEventSizeFuse } from './sanitize'
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

  // 单条事件体积保险丝：无论事件来自前端桥接还是主进程自身，落盘/推送前统一过一遍，
  // 防止超大 context（如异常巨大的完整捕获内容）拖垮写入队列与渲染层实时展示。
  const safeEvents = events.map(applyEventSizeFuse)
  await writeLogEventsToFile(safeEvents)
  pushLogEvents(safeEvents)
}
