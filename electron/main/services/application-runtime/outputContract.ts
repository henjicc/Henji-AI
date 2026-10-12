import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv'
import { app } from 'electron'
import type { ApplicationResult } from '../../../../src/core/application-control/invocation'
import { createMainLogger } from '../logging'

// 与外部 MCP 客户端、目录扫描共用同一个完整 JSON Schema 实现。
export const applicationOutputValidator = new AjvJsonSchemaValidator()
const logger = createMainLogger('main.application_runtime.output_contract')

/** 标准图片附件不属于 structuredContent；Pi/MCP 都校验客户端实际看到的元数据。 */
export function applicationStructuredContent(result: ApplicationResult): ApplicationResult {
  const media = result.data
  if (result.ok && media?.mode === 'image' && typeof media.base64 === 'string' && media.mimeType === 'image/jpeg') {
    const { base64: _base64, ...metadata } = media
    return { ...result, data: metadata }
  }
  return result
}

export function validateApplicationToolOutput(name: string, schema: Record<string, unknown> | undefined,
  result: ApplicationResult, mode = app?.isPackaged ? 'production' : process.env.NODE_ENV): void {
  if (!schema) return
  // 错误回执不受成功 outputSchema 约束，与官方客户端 isError 行为一致。
  if (!result.ok && result.executionState !== 'awaiting_user_confirmation') return
  const checked = applicationOutputValidator.getValidator(schema)(applicationStructuredContent(result))
  if (checked.valid) return
  // 不记录返回值，避免把私密正文、媒体或凭据写入日志。
  logger.error('应用工具返回不符合声明', { event: 'application.output_contract.failed',
    context: { capabilityId: name, validationError: checked.errorMessage } })
  if (mode !== 'production') throw new Error(`APPLICATION_OUTPUT_CONTRACT:${name}:${checked.errorMessage}`)
}
