import { createLogger } from '@/core/logging'
import { userErrorText } from '@/core/userErrorText'

const logger = createLogger('features.audioEdit.userError')
const INTERNAL = /AUDIO_WORKER_TIMEOUT|Worker|协议|进程|未返回处理结果|缓存缺失/

/**
 * 口播里的失败原因转成用户能照着做的一句话。主进程的原因带错误码前缀（如 `NOT_FOUND：`），
 * 助手按码分支，界面去掉前缀；声音处理进程超时、退出、协议不符这类内部原因与英文原始错误只进日志。
 */
export function audioEditUserErrorMessage(error: unknown, fallback = '这一步没能完成，修改已保留，请重试。'): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = INTERNAL.test(raw) ? '声音处理没有完成（处理超时或意外中断），修改已保留，请重试。' : userErrorText(error, fallback)
  if (message !== raw) logger.warn('口播失败原因已换成用户语言', { event: 'audio_edit.error.internal_text', context: { message: raw.slice(0, 500) } })
  return message
}
