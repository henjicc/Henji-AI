import { z } from 'zod'

/*
 * 文档文件外壳（实施方案 2.4）：剪辑、画布、口播、镜头参考各是一个 JSON 文件，外壳统一，
 * `content` 由各类型自己定义（见 kinds/）。图片文档是单文件包，头信息由主进程的包适配器读写。
 *
 * 文件里 content 中的位置是存储写法（henji:/ 等），读出后由主进程文档仓库换回绝对路径。
 */

export const DOCUMENT_FORMAT = 'henji-document' as const
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
/** 单个文档文件的读取预算，避免一次解析占满主进程内存；超出不等于文件损坏。 */
export const MAX_DOCUMENT_FILE_BYTES = 256 * 1024 * 1024

export const documentIdSchema = z.string().regex(DOCUMENT_ID_PATTERN, '文档 ID 无效。')
const isoTimestampSchema = z.iso.datetime({ offset: true })

export interface DocumentEnvelope {
  format: typeof DOCUMENT_FORMAT
  kind: string
  kindVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  revision: number
  /** 只在为草稿时写出。 */
  draft?: true
  content: unknown
}

export const documentEnvelopeSchema = z.object({
  format: z.literal(DOCUMENT_FORMAT),
  kind: z.string().min(1).max(64),
  kindVersion: z.number().int().positive(),
  id: documentIdSchema,
  name: z.string().min(1).max(255),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  revision: z.number().int().nonnegative(),
  draft: z.boolean().optional(),
  content: z.unknown().refine((value) => value !== undefined, '文档缺少内容。'),
}).strict()

export class DocumentFormatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocumentFormatError'
  }
}

/** 校验外壳；类型是否登记、版本能否打开由调用方按登记表判断。 */
export function parseDocumentEnvelope(raw: unknown): DocumentEnvelope {
  const result = documentEnvelopeSchema.safeParse(raw)
  if (!result.success) {
    throw new DocumentFormatError(`不是有效的痕迹AI文档：${result.error.issues[0]?.message ?? '格式错误'}`, { cause: result.error })
  }
  const { draft, ...rest } = result.data
  return buildDocumentEnvelope({ ...rest, draft: draft === true })
}

export interface DocumentEnvelopeFields extends Omit<DocumentEnvelope, 'format' | 'draft'> {
  draft: boolean
}

/** 按固定字段顺序组装外壳，草稿标记只在为真时写出。 */
export function buildDocumentEnvelope(fields: DocumentEnvelopeFields): DocumentEnvelope {
  return {
    format: DOCUMENT_FORMAT,
    kind: fields.kind,
    kindVersion: fields.kindVersion,
    id: fields.id,
    name: fields.name,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    revision: fields.revision,
    ...(fields.draft ? { draft: true as const } : {}),
    content: fields.content,
  }
}

/** 紧凑 JSON + 换行；体积小，适合放在可能被同步盘同步的作品目录里。 */
export function serializeDocumentEnvelope(envelope: DocumentEnvelope): string {
  return `${JSON.stringify(envelope)}\n`
}

export function parseDocumentText(text: string): DocumentEnvelope {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch (error) {
    throw new DocumentFormatError('文档文件已损坏，无法读取。', { cause: error })
  }
  return parseDocumentEnvelope(raw)
}

export function toTimestamp(iso: string): number {
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : 0
}
