import { createLogger } from '@/core/logging'
import { publishVideoEdit } from './videoEditService'

const logger = createLogger('features.videoEdit.safeMargins')
/** 节目与源监视器是否显示安全框（本机视图偏好，所有剪辑共用，不写进剪辑文件、不进撤销栈）。 */
const STORAGE_KEY = 'videoEdit.safeMargins.v1'
let visible: boolean | undefined

function storage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

export function videoEditSafeMarginsVisible(): boolean {
  if (visible === undefined) { try { visible = storage()?.getItem(STORAGE_KEY) === 'true' } catch { visible = false } }
  return visible
}

/** 界面按钮、菜单与快捷键共用的唯一写入口。 */
export function setVideoEditSafeMarginsVisible(next: boolean): void {
  if (videoEditSafeMarginsVisible() === next) return
  visible = next
  try { storage()?.setItem(STORAGE_KEY, String(next)) } catch (error) { logger.debug('安全框偏好未能写入本机', { event: 'video_edit.safe_margins.persist_failed', error }) }
  publishVideoEdit()
}

/** 仅测试：清掉内存里的偏好，下次从本机存储重新读取。 */
export function resetVideoEditSafeMarginsCache(): void { visible = undefined }
