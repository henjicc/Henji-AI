import fs from 'node:fs/promises'
import path from 'node:path'
import { getProgramStoreDir } from '../appBasePaths'
import { MAIN_LOG_FILE_PREFIX, type MainLogEvent } from './types'

export function getLogDir(): string {
  return getProgramStoreDir('logs')
}

export function getLogFilePath(date = new Date()): string {
  return path.join(getLogDir(), `${MAIN_LOG_FILE_PREFIX}${date.toISOString().slice(0, 10)}.log`)
}

// 写入队列：串行化所有 appendFile 调用，避免并发写入（前端批量桥接 + 主进程自身
// 日志同时触发）时互相交错或 mkdir 竞争。
let writeQueue: Promise<void> = Promise.resolve()

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(task, task)
  writeQueue = next.catch(() => undefined)
  return next
}

export async function writeLogEventsToFile(events: MainLogEvent[]): Promise<void> {
  if (events.length === 0) {
    return
  }

  const lines = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  await enqueueWrite(async () => {
    await fs.mkdir(getLogDir(), { recursive: true })
    await fs.appendFile(getLogFilePath(), lines, 'utf8')
  })
}
