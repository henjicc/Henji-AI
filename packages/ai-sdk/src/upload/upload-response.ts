import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { readJsonResponse } from '../providers/helpers'
import type { JsonValue } from '../types/runtime'

export async function readUploadJson(response: Response, label: string): Promise<JsonValue> {
  try {
    return await readJsonResponse(response, label)
  } catch (error) {
    // 解析与 HTTP 诊断只走公共入口；上传层仅保留原有 upload_failed 契约。
    if (error instanceof AiRuntimeError && ['provider_http_error', 'invalid_json'].includes(error.code)) {
      const message = error.message.replace(`[${error.code}] `, '')
      throw new AiRuntimeError('upload_failed', message, error.details)
    }
    // 正文读取取消/网络失败及明确的供应商准入错误保留原语义。
    throw error
  }
}

export function readUploadString(value: JsonValue, pointer: string): string | undefined {
  let current: JsonValue | undefined = value
  for (const rawPart of pointer.split('/').slice(1)) {
    if (!isJsonObject(current) && !Array.isArray(current)) return undefined
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
    current = Array.isArray(current) ? current[Number(part)] : current[part]
  }
  return typeof current === 'string' ? current : undefined
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
