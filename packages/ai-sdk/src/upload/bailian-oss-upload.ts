import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { assertMediaSize } from '../runtime/MediaReader'
import type { Transport } from '../runtime/Transport'

/** 百炼临时存储：凭证按模型签发、不能跨模型复用；对象 48 小时后过期，模型请求要带 X-DashScope-OssResourceResolve。 */
export const BAILIAN_DEFAULT_API_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

export interface BailianUploadTarget {
  /** 表单直传地址（HTTPS） */
  uploadUrl: string
  /** 按官方顺序排好的表单字段，文件字段名为 file */
  fields: [string, string][]
  objectKey: string
  maxBytes: number
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function requiredString(record: UnknownRecord | undefined, key: string): string {
  const value = record?.[key]
  if (typeof value !== 'string' || !value) throw new AiRuntimeError('invalid_response', `Bailian upload policy has no ${key}`)
  return value
}

/** 申请一次上传凭证并算好对象路径；objectName 只用作文件名的可读部分。 */
export async function requestBailianUploadTarget(input: {
  transport: Transport
  apiKey: string
  modelId: string
  objectName: string
  apiBaseUrl?: string
  signal?: AbortSignal
}): Promise<BailianUploadTarget> {
  const response = await input.transport.fetch(
    `${input.apiBaseUrl ?? BAILIAN_DEFAULT_API_BASE_URL}/uploads?action=getPolicy&model=${encodeURIComponent(input.modelId)}`,
    { headers: { Authorization: `Bearer ${input.apiKey}` }, signal: input.signal },
  )
  const text = await response.text()
  if (!response.ok) throw new AiRuntimeError('provider_http_error', `Bailian upload policy failed with HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new AiRuntimeError('invalid_response', 'Bailian upload policy returned invalid JSON') }
  const policy = asRecord(asRecord(payload)?.data)
  let host: URL
  try { host = new URL(requiredString(policy, 'upload_host')) } catch (error) {
    if (error instanceof AiRuntimeError) throw error
    throw new AiRuntimeError('invalid_response', 'Bailian upload_host is invalid')
  }
  if (host.protocol !== 'https:') throw new AiRuntimeError('invalid_response', 'Bailian upload_host must use HTTPS')
  const uploadDir = requiredString(policy, 'upload_dir').replace(/^\/+|\/+$/g, '')
  const rawLimit = policy?.max_file_size_mb
  const maxFileSizeMb = typeof rawLimit === 'number' || typeof rawLimit === 'string' ? Number(rawLimit) : NaN
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
    throw new AiRuntimeError('invalid_response', 'Bailian upload policy has invalid max_file_size_mb')
  }
  const objectKey = `${uploadDir}/${input.objectName.replace(/[^A-Za-z0-9._-]/g, '_')}`
  return {
    uploadUrl: host.toString(),
    fields: [
      ['OSSAccessKeyId', requiredString(policy, 'oss_access_key_id')],
      ['Signature', requiredString(policy, 'signature')],
      ['policy', requiredString(policy, 'policy')],
      ['x-oss-object-acl', requiredString(policy, 'x_oss_object_acl')],
      ['x-oss-forbid-overwrite', requiredString(policy, 'x_oss_forbid_overwrite')],
      ['key', objectKey],
      ['success_action_status', '200'],
    ],
    objectKey,
    // 官方临时存储单文件上限 1 GB，按十进制字节保守换算。
    maxBytes: Math.min(1_000_000_000, Math.floor(maxFileSizeMb * 1_000_000)),
  }
}

/** 把内存里的字节传到临时存储，返回模型可用的 oss:// 地址。 */
export async function uploadBytesToBailianOss(input: {
  transport: Transport
  apiKey: string
  modelId: string
  objectName: string
  bytes: Uint8Array
  mimeType: string
  filename: string
  apiBaseUrl?: string
  signal?: AbortSignal
}): Promise<string> {
  const target = await requestBailianUploadTarget(input)
  assertMediaSize({ size: input.bytes.byteLength, mimeType: input.mimeType, filename: input.filename }, target.maxBytes)
  const form = new FormData()
  for (const [key, value] of target.fields) form.append(key, value)
  form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename)
  const response = await input.transport.fetch(target.uploadUrl, { method: 'POST', body: form, signal: input.signal })
  if (!response.ok) throw new AiRuntimeError('upload_failed', `Bailian OSS upload failed with HTTP ${response.status}`)
  return `oss://${target.objectKey}`
}
