import { unitPrice } from '../../pricing/capabilityPricing'
import { resolveRuntimeContext, type ResolvedRuntimeContext, type RuntimeContext } from '../../runtime/RuntimeContext'
import { AiRuntimeError, cancelledError } from '../../runtime/AiRuntimeError'
import { multipartAudioRequest, prepareMedia, sendMediaRequest } from '../media-request'
import type { CapabilityMediaSource } from '../media'
import type { CapabilityModule } from '../types'
import { deepSeekApiRoot, deepSeekToolsEndpoint, readDeepSeekToolJson } from './http'
import type { DeepSeekToolsModuleOptions } from './web'

/**
 * text：不含图片的 Word、PowerPoint 直接提取文字，其余逐页识别；rich_layout：全部逐页识别，
 * 文字里保留 `<｜ref｜>…<｜box｜>[[x1, y1, x2, y2]]` 标记，坐标按页宽高归一化到 0–1000。
 */
export type DeepSeekDocumentLayout = 'text' | 'rich_layout'

export interface DocumentOcrInput {
  /** PDF、DOC/DOCX、PPT/PPTX，或 PNG、JPEG、WebP、GIF、BMP、TIFF 图片；格式按内容判断，需带文件名。 */
  file: CapabilityMediaSource
  layout?: DeepSeekDocumentLayout
}

export interface DocumentOcrPage {
  /** 从 0 开始。 */
  index: number
  text: string
  /** length 表示该页输出达到上限、文字不完整。 */
  finishReason: 'stop' | 'length'
}

export interface DocumentOcrOutput {
  pageCount: number
  pages: readonly DocumentOcrPage[]
}

const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024
const PURPOSE: Readonly<Record<DeepSeekDocumentLayout, string>> = { text: 'text_recognition', rich_layout: 'rich_layout_recognition' }

async function apiKey(runtime: ResolvedRuntimeContext): Promise<string> {
  const value = (await runtime.credentials.get('generation', 'deepseek'))?.trim()
  if (!value) throw new AiRuntimeError('api_key_missing', 'DeepSeek API 密钥未配置')
  return value
}

async function uploadDocument(runtime: ResolvedRuntimeContext, url: string, file: CapabilityMediaSource, fields: [string, string][], signal: AbortSignal, action: string): Promise<Record<string, unknown>> {
  if (signal.aborted) throw cancelledError('deepseek-document')
  if (file?.kind === 'remote-url') throw new AiRuntimeError('unsupported_media_source', `DeepSeek ${action}需要上传文件内容，不接受远程地址`)
  const media = await prepareMedia(file, runtime, MAX_DOCUMENT_BYTES, signal)
  // 官方要求 purpose 写在 file 之前；multipart 请求先写普通字段再写文件。
  const response = await sendMediaRequest(runtime, url, {
    method: 'POST', headers: { Authorization: `Bearer ${await apiKey(runtime)}` }, signal,
  }, multipartAudioRequest(media, fields))
  return readDeepSeekToolJson(response, action)
}

/**
 * 文档与图片文字识别，按页返回。文件不进入 Files API、也不交给对话模型。
 * 官方总时长上限 180 秒（含上传、识别与返回）；客户端断开不会取消识别，完成的页照常计费。
 */
export function createDeepSeekDocumentOcrModule(options: DeepSeekToolsModuleOptions = {}): CapabilityModule<DocumentOcrInput, DocumentOcrOutput> {
  const url = deepSeekToolsEndpoint(options.apiBaseUrl, 'ocr')
  return {
    descriptor: {
      id: 'deepseek.document-ocr', kind: 'document-ocr', source: { kind: 'builtin', namespace: '@henjicc/ai-sdk' }, providerIds: ['deepseek'], modelId: 'deepseek-ocr',
      contract: { input: [{ kind: 'pdf', required: true, mediaTypes: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'] }], output: [{ kind: 'text' }] },
      // 1.5 元/千页，按识别成功的页数计费。
      pricing: unitPrice('CNY', 'page', 0.0015),
    },
    execute: async (input, context) => {
      const layout = input?.layout ?? 'text'
      if (!(layout in PURPOSE)) throw new AiRuntimeError('invalid_parameter', 'layout 只能是 text 或 rich_layout')
      const payload = await uploadDocument(context.runtime, url, input.file, [['purpose', PURPOSE[layout]]], context.signal, '文字识别')
      if (!Array.isArray(payload.pages)) throw new AiRuntimeError('invalid_response', 'DeepSeek 文字识别没有返回页面')
      const pages = payload.pages.flatMap((page, position): DocumentOcrPage[] => {
        if (!page || typeof page !== 'object') return []
        const value = page as Record<string, unknown>
        return [{
          index: typeof value.index === 'number' ? value.index : position,
          text: typeof value.text === 'string' ? value.text : '',
          finishReason: value.finish_reason === 'length' ? 'length' : 'stop',
        }]
      })
      return { pageCount: typeof payload.page_count === 'number' ? payload.page_count : pages.length, pages }
    },
  }
}

/** user_data：纯文本、表格、电子书，不计费；另外两种按页一次性计解析费，见 DeepSeekDocumentLayout。 */
export type DeepSeekFilePurpose = 'user_data' | 'text_recognition' | 'rich_layout_recognition'

export interface DeepSeekFileObject {
  id: string
  bytes: number
  createdAt: number
  filename: string
  purpose: string
}

function fileObject(value: unknown): DeepSeekFileObject {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (typeof item.id !== 'string' || !item.id) throw new AiRuntimeError('invalid_response', 'DeepSeek 文件接口没有返回文件 ID')
  return {
    id: item.id,
    bytes: typeof item.bytes === 'number' ? item.bytes : 0,
    createdAt: typeof item.created_at === 'number' ? item.created_at : 0,
    filename: typeof item.filename === 'string' ? item.filename : '',
    purpose: typeof item.purpose === 'string' ? item.purpose : '',
  }
}

export interface DeepSeekFilesClient {
  /** 解析完成后才返回；之后在对话里用 file_id 引用（Chat 为 file 内容块，Responses 为 input_file）。 */
  upload(file: CapabilityMediaSource, purpose: DeepSeekFilePurpose, signal?: AbortSignal): Promise<DeepSeekFileObject>
  list(query?: { purpose?: DeepSeekFilePurpose; after?: string; limit?: number; order?: 'asc' | 'desc' }, signal?: AbortSignal): Promise<readonly DeepSeekFileObject[]>
  get(fileId: string, signal?: AbortSignal): Promise<DeepSeekFileObject>
  remove(fileId: string, signal?: AbortSignal): Promise<void>
}

/** DeepSeek Files API。上传的原文件与解析结果都不能下载。 */
export function createDeepSeekFilesClient(context: RuntimeContext, options: DeepSeekToolsModuleOptions = {}): DeepSeekFilesClient {
  const runtime = resolveRuntimeContext(context)
  const root = `${deepSeekApiRoot(options.apiBaseUrl)}/files`
  const request = async (url: string, method: 'GET' | 'DELETE', signal: AbortSignal | undefined, action: string) => readDeepSeekToolJson(
    await runtime.transport.fetch(url, { method, headers: { Authorization: `Bearer ${await apiKey(runtime)}` }, signal }), action)
  const fileUrl = (fileId: string): string => {
    if (!fileId.trim()) throw new AiRuntimeError('invalid_parameter', '文件 ID 不能为空')
    return `${root}/${encodeURIComponent(fileId.trim())}`
  }
  return {
    upload: async (file, purpose, signal) => fileObject(await uploadDocument(runtime, root, file, [['purpose', purpose]], signal ?? new AbortController().signal, '文件上传')),
    list: async (query = {}, signal) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
      const payload = await request(`${root}${params.size ? `?${params}` : ''}`, 'GET', signal, '文件列表')
      return Array.isArray(payload.data) ? payload.data.map(fileObject) : []
    },
    get: async (fileId, signal) => fileObject(await request(fileUrl(fileId), 'GET', signal, '文件查询')),
    remove: async (fileId, signal) => {
      const payload = await request(fileUrl(fileId), 'DELETE', signal, '文件删除')
      if (payload.deleted !== true) throw new AiRuntimeError('invalid_response', 'DeepSeek 文件删除没有确认成功')
    },
  }
}
