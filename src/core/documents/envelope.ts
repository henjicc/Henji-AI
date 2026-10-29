import { z } from 'zod'
import { persistenceForwardFields, upgradePersistenceContent, type PersistenceContract } from '../persistence/migrations'
import { restoreForwardFields } from '../persistence/forwardCompat'

/*
 * 文档文件外壳（实施方案 2.4）：剪辑、画布、口播、镜头参考各是一个 JSON 文件，外壳统一，
 * `content` 由各类型自己定义（见 kinds/）。图片文档是单文件包，头信息由主进程的包适配器读写。
 *
 * 文件里 content 中的位置是存储写法（henji:/ 等），读出后由主进程文档仓库换回绝对路径。
 */

export const DOCUMENT_FORMAT = 'henji-document' as const
export const DOCUMENT_ENVELOPE_VERSION = 1
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const documentIdSchema = z.string().regex(DOCUMENT_ID_PATTERN, '文档 ID 无效。')
const isoTimestampSchema = z.iso.datetime({ offset: true })

/**
 * 外壳时间统一写 ISO 字符串。外部脚本或工具改写文件时常把它写成毫秒时间戳：内容完好，只是写法不同，
 * 校验前按同一时刻换成 ISO（下次保存即写回标准写法），不因此拒绝整份作品。schema 本身不变。
 */
function normalizeEnvelopeTimestamps(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const record = raw as Record<string, unknown>
  const convert = (value: unknown): unknown => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8.64e15 ? new Date(value).toISOString() : value
  if (typeof record.createdAt !== 'number' && typeof record.updatedAt !== 'number') return raw
  return { ...record, createdAt: convert(record.createdAt), updatedAt: convert(record.updatedAt) }
}

export interface DocumentEnvelope {
  format: typeof DOCUMENT_FORMAT
  envelopeVersion: number
  /** 能读懂这个外壳的最低外壳版本。 */
  minReaderVersion: number
  kind: string
  kindVersion: number
  /** 能读懂 content 的最低内容版本；只新增可选字段时与旧版本相同。 */
  kindMinReaderVersion: number
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
  envelopeVersion: z.literal(DOCUMENT_ENVELOPE_VERSION),
  minReaderVersion: z.number().int().positive().max(DOCUMENT_ENVELOPE_VERSION).optional(),
  kind: z.string().min(1).max(64),
  kindVersion: z.number().int().positive(),
  kindMinReaderVersion: z.number().int().positive().optional(),
  id: documentIdSchema,
  name: z.string().min(1).max(255),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  revision: z.number().int().nonnegative(),
  draft: z.boolean().optional(),
  content: z.unknown().refine((value) => value !== undefined, '文档缺少内容。'),
}).strict()

/** 外壳先迁移，kind 内容随后由文档仓库迁移；两条版本链互不绑定。 */
export const documentEnvelopeContract: PersistenceContract = {
  id: 'document-envelope', name: '文档外壳', version: DOCUMENT_ENVELOPE_VERSION,
  schema: documentEnvelopeSchema, migrations: {},
}

/** 外壳版本引入前保存的文档就是第 1 版外壳：缺字段按 1 读取并补上，绝不因此拒绝用户已有作品。 */
export function documentEnvelopeVersion(raw: unknown): number {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('envelopeVersion' in raw)) return 1
  return raw && typeof raw === 'object' && 'envelopeVersion' in raw && typeof raw.envelopeVersion === 'number' ? raw.envelopeVersion : 0
}

/** 外壳自身的最低可读版本；缺省视为文件自身版本（不能被更旧的程序读取）。 */
export function documentEnvelopeMinReaderVersion(raw: unknown): number | undefined {
  return raw && typeof raw === 'object' && 'minReaderVersion' in raw && typeof raw.minReaderVersion === 'number' ? raw.minReaderVersion : undefined
}

/** 更新版本写出、本程序仍可读的外壳：保存时带回原版本戳与本程序不认识的外壳字段。 */
const envelopeForward = new WeakMap<DocumentEnvelope, { envelopeVersion: number; minReaderVersion: number; fields: ReturnType<typeof persistenceForwardFields> }>()

export function upgradeDocumentEnvelope(raw: unknown, backupPath?: string): DocumentEnvelope {
  raw = normalizeEnvelopeTimestamps(raw)
  const version = documentEnvelopeVersion(raw)
  const minReaderVersion = documentEnvelopeMinReaderVersion(raw)
  const forward = version > DOCUMENT_ENVELOPE_VERSION
  // 前向读取按本程序的外壳 schema 校验：版本字段换成当前值，原版本戳另行保存。
  const input = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...(!('envelopeVersion' in raw) || forward ? { envelopeVersion: DOCUMENT_ENVELOPE_VERSION } : {}), ...(forward ? { minReaderVersion: DOCUMENT_ENVELOPE_VERSION } : {}) }
    : raw
  const parsed = upgradePersistenceContent(documentEnvelopeContract, input, version, backupPath, minReaderVersion) as z.infer<typeof documentEnvelopeSchema>
  const { draft, minReaderVersion: _ignored, kindMinReaderVersion, ...rest } = parsed
  const envelope: DocumentEnvelope = { ...rest, envelopeVersion: DOCUMENT_ENVELOPE_VERSION, minReaderVersion: DOCUMENT_ENVELOPE_VERSION,
    kindMinReaderVersion: kindMinReaderVersion ?? rest.kindVersion, ...(draft === true ? { draft: true as const } : {}) }
  if (forward) envelopeForward.set(envelope, { envelopeVersion: version, minReaderVersion: minReaderVersion!, fields: persistenceForwardFields(parsed) })
  return envelope
}

/** 写回同一文件时调用：把源文件的前向外壳版本戳与未知字段带到新外壳；非前向文件原样返回。 */
export function carryDocumentEnvelopeForward(source: DocumentEnvelope, next: DocumentEnvelope): DocumentEnvelope {
  const forward = envelopeForward.get(source)
  if (!forward) return next
  const carried = { ...restoreForwardFields(next, forward.fields), envelopeVersion: forward.envelopeVersion, minReaderVersion: forward.minReaderVersion }
  envelopeForward.set(carried, forward)
  return carried
}

export class DocumentFormatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocumentFormatError'
  }
}

/** 校验外壳；类型是否登记、版本能否打开由调用方按登记表判断。 */
export function parseDocumentEnvelope(raw: unknown): DocumentEnvelope {
  const result = documentEnvelopeSchema.safeParse(normalizeEnvelopeTimestamps(raw))
  if (!result.success) {
    throw new DocumentFormatError(`不是有效的痕迹AI文档：${result.error.issues[0]?.message ?? '格式错误'}`, { cause: result.error })
  }
  const { draft, minReaderVersion: _minReaderVersion, kindMinReaderVersion, ...rest } = result.data
  return buildDocumentEnvelope({ ...rest, kindMinReaderVersion: kindMinReaderVersion ?? rest.kindVersion, draft: draft === true })
}

export interface DocumentEnvelopeFields extends Omit<DocumentEnvelope, 'format' | 'envelopeVersion' | 'minReaderVersion' | 'kindMinReaderVersion' | 'draft'> {
  draft: boolean
  /** 省略时等于 kindVersion：本文件不能被更旧的内容版本读取。 */
  kindMinReaderVersion?: number
}

/** 按固定字段顺序组装外壳，草稿标记只在为真时写出。 */
export function buildDocumentEnvelope(fields: DocumentEnvelopeFields): DocumentEnvelope {
  return {
    format: DOCUMENT_FORMAT,
    envelopeVersion: DOCUMENT_ENVELOPE_VERSION,
    minReaderVersion: DOCUMENT_ENVELOPE_VERSION,
    kind: fields.kind,
    kindVersion: fields.kindVersion,
    kindMinReaderVersion: fields.kindMinReaderVersion ?? fields.kindVersion,
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

export function parseDocumentRawText(text: string): unknown {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch (error) {
    throw new DocumentFormatError('文档文件已损坏，无法读取。', { cause: error })
  }
  return raw
}

/** 纯内存导入；文件调用方须在迁移前完成原件备份。 */
export function parseDocumentText(text: string): DocumentEnvelope {
  return upgradeDocumentEnvelope(parseDocumentRawText(text))
}

export function toTimestamp(iso: string): number {
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : 0
}
