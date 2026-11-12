import { powerSaveBlocker } from 'electron'
import { createMainLogger } from './logging'

const logger = createMainLogger('main.recording_power')
const holders = new Map<number, string>()
let blockerId: number | null = null
let nextHolder = 0

/**
 * 录音、录屏进行中阻止系统挂起：睡眠会让原生采集超过 5 秒没有回调而判定设备丢失、录屏子进程被挂起。
 * 只拦挂起不拦息屏，长时间口播可以关掉屏幕。多路录制共用一个系统请求，最后一路结束才放开；返回的释放函数可重复调用。
 */
export function holdRecordingWakeLock(reason: string): () => void {
  const id = ++nextHolder
  holders.set(id, reason)
  if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    logger.info('录制期间阻止系统睡眠', { event: 'recording_power.hold.start', context: { reason } })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holders.delete(id)
    if (holders.size || blockerId === null) return
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = null
    logger.info('录制结束，恢复系统睡眠', { event: 'recording_power.hold.completed', context: { reason } })
  }
}
