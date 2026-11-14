import { ZodError } from 'zod'
import { createLogger } from '@/core/logging'
import { fileSystemErrorText, isUserLanguageText } from '@/core/userErrorText'

const logger = createLogger('features.videoEdit.userError')

/**
 * 剪辑里的失败原因转成用户能看懂的一句话：业务错误本来就是用户语言，原样显示；
 * 参数校验（zod）等内部错误只进日志，界面显示“数值超出允许范围”这类说明，不把 schema 路径、错误码摊给用户。
 */
export function videoEditUserErrorMessage(reason: unknown): string {
  const zod = reason instanceof ZodError ? reason : reason instanceof Error && reason.cause instanceof ZodError ? reason.cause : null
  if (zod) {
    logger.warn('剪辑参数校验未通过', { event: 'video_edit.validation.failed', context: { issues: zod.issues.slice(0, 5).map(issue => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })) } })
    return zod.issues.some(issue => issue.code === 'too_big' || issue.code === 'too_small') ? '数值超出允许范围，已保持原值。' : '这次修改的内容无效，已保持原值。'
  }
  const message = reason instanceof Error ? reason.message : String(reason)
  // 未包装的校验结果（JSON 形式的错误列表）同样不直接显示
  if (/^\s*\[\s*\{[\s\S]*"code"\s*:/.test(message)) {
    logger.warn('剪辑操作返回了内部错误文本', { event: 'video_edit.error.internal_text', context: { message: message.slice(0, 500) } })
    return /too_big|too_small/.test(message) ? '数值超出允许范围，已保持原值。' : '这次修改的内容无效，已保持原值。'
  }
  // 主进程原样转来的文件系统错误带错误码和内部路径，只进日志
  const fileSystem = fileSystemErrorText(message)
  if (fileSystem) {
    logger.warn('剪辑操作返回了文件系统错误', { event: 'video_edit.error.file_system', context: { message: message.slice(0, 500) } })
    return fileSystem
  }
  if (isVideoEditRuntimeText(message)) {
    logger.warn('剪辑操作返回了运行时原始错误', { event: 'video_edit.error.runtime_text', context: { message: message.slice(0, 500) } })
    return '这一步没能完成，请重试；仍然失败就重启软件。'
  }
  return message
}

/** 浏览器、显卡驱动、编解码库直接抛出的英文原始错误（如 WebGPU 的 importExternalTexture 失败）：只进详情和日志。 */
export function isVideoEditRuntimeText(message: string): boolean {
  return message.trim() !== '' && !isUserLanguageText(message)
}
