import crypto from 'node:crypto'

import type { ImageEditDocumentEnvelope } from '../contracts'

/*
 * 图片文档头（3.5 图片文档）：写在 `.henjiimg` 里单独的小条目 `henji-document.json`。
 *
 * - id：文档稳定 ID（作品索引、跨文档引用、程序目录工作副本都按它找）；包内 manifest 的
 *   V3 文档 ID 与它保持一致（副本换 ID 时一并改写）。
 * - 名称不写进包：文档名就是文件名，改名只改文件名，不重写可能很大的包。
 * - revision：写回次数，打开时记下，写回前核对；文件在别处被换掉时报冲突。
 * - contentRevision：包里 V3 文档的版本；emptyUntilRevision：新建空白图片时的版本，
 *   之后没有任何编辑（contentRevision 不超过它）就算空内容，草稿离开时直接删除。
 * - summary：列表摘要（成品尺寸、图层数），扫描时不用解压文档。
 */

export const IMAGE_DOCUMENT_HEADER_FORMAT = 'henji-image-document' as const
export const IMAGE_DOCUMENT_HEADER_VERSION = 1 as const
/** 图片文档类型的内容版本（与 `src/core/documents/kinds/imageDocument.ts` 一致）。 */
export const IMAGE_DOCUMENT_KIND_VERSION = 1

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_HEADER_BYTES = 64 * 1024

export interface ImageDocumentSummary {
  width: number
  height: number
  layers: number
}

export interface HenjiImageDocumentHeader {
  format: typeof IMAGE_DOCUMENT_HEADER_FORMAT
  version: typeof IMAGE_DOCUMENT_HEADER_VERSION
  id: string
  draft: boolean
  revision: number
  kindVersion: number
  createdAt: string
  updatedAt: string
  contentRevision: number
  emptyUntilRevision: number | null
  summary: ImageDocumentSummary
}

export class ImageDocumentHeaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentFormatError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ImageDocumentHeaderError(`图片文档头的${label}无效`)
  return value as number
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ImageDocumentHeaderError(`图片文档头的${label}无效`)
  return value
}

export function isImageDocumentId(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_ID_PATTERN.test(value)
}

export function parseImageDocumentHeader(value: unknown): HenjiImageDocumentHeader {
  if (!isRecord(value)) throw new ImageDocumentHeaderError('图片文档头格式错误')
  if (value.format !== IMAGE_DOCUMENT_HEADER_FORMAT || value.version !== IMAGE_DOCUMENT_HEADER_VERSION) {
    throw new ImageDocumentHeaderError('图片文档头的版本不受支持，请升级痕迹AI后再打开')
  }
  if (!isImageDocumentId(value.id)) throw new ImageDocumentHeaderError('图片文档头的 ID 无效')
  const summary = isRecord(value.summary) ? value.summary : {}
  const emptyUntil = value.emptyUntilRevision
  return {
    format: IMAGE_DOCUMENT_HEADER_FORMAT,
    version: IMAGE_DOCUMENT_HEADER_VERSION,
    id: value.id,
    draft: value.draft === true,
    revision: nonNegativeInteger(value.revision, '版本'),
    kindVersion: Math.max(1, nonNegativeInteger(value.kindVersion, '内容版本')),
    createdAt: timestamp(value.createdAt, '创建时间'),
    updatedAt: timestamp(value.updatedAt, '修改时间'),
    contentRevision: nonNegativeInteger(value.contentRevision, '内容版本'),
    emptyUntilRevision: emptyUntil === null || emptyUntil === undefined ? null : nonNegativeInteger(emptyUntil, '空白版本'),
    summary: {
      width: Number.isSafeInteger(summary.width) ? Number(summary.width) : 0,
      height: Number.isSafeInteger(summary.height) ? Number(summary.height) : 0,
      layers: Number.isSafeInteger(summary.layers) ? Number(summary.layers) : 0,
    },
  }
}

export function parseImageDocumentHeaderBytes(bytes: Buffer): HenjiImageDocumentHeader {
  if (bytes.byteLength > MAX_HEADER_BYTES) throw new ImageDocumentHeaderError('图片文档头过大，文件可能已损坏')
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new ImageDocumentHeaderError('图片文档头不是有效的 JSON')
  }
  return parseImageDocumentHeader(value)
}

/** 固定字段顺序；草稿标记、空白版本只在需要时写出。 */
export function serializeImageDocumentHeader(header: HenjiImageDocumentHeader): string {
  return `${JSON.stringify({
    format: header.format,
    version: header.version,
    id: header.id,
    ...(header.draft ? { draft: true } : {}),
    revision: header.revision,
    kindVersion: header.kindVersion,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    contentRevision: header.contentRevision,
    ...(header.emptyUntilRevision === null ? {} : { emptyUntilRevision: header.emptyUntilRevision }),
    summary: header.summary,
  })}\n`
}

export function isImageDocumentHeaderEmpty(header: Pick<HenjiImageDocumentHeader, 'contentRevision' | 'emptyUntilRevision'>): boolean {
  return header.emptyUntilRevision !== null && header.contentRevision <= header.emptyUntilRevision
}

function countLayers(layers: unknown): number {
  if (!Array.isArray(layers)) return 0
  let count = 0
  for (const layer of layers) {
    count += 1
    if (isRecord(layer)) count += countLayers(layer.children)
  }
  return count
}

/** 列表摘要：成品尺寸（裁剪、旋转后）与图层数（含组内图层）。 */
export function summarizeImageEditDocument(document: unknown): ImageDocumentSummary {
  if (!isRecord(document) || !isRecord(document.geometry)) return { width: 0, height: 0, layers: countLayers(isRecord(document) ? document.layers : []) }
  const geometry = document.geometry
  const crop = isRecord(geometry.crop) ? geometry.crop : null
  let width = Number(crop?.width ?? geometry.width) || 0
  let height = Number(crop?.height ?? geometry.height) || 0
  const rotate = isRecord(geometry.orientation) ? Number(geometry.orientation.rotate) : 0
  // 裁剪框在旋转后的坐标系里；只有没有裁剪时才需要按旋转交换宽高。
  if (!crop && (rotate === 90 || rotate === 270)) [width, height] = [height, width]
  return { width, height, layers: countLayers(document.layers) }
}

/**
 * 没有文档头的旧包（3.5 之前“保存可编辑文件”写出的）：按 manifest 推出头信息。
 * ID 由包内 V3 文档 ID 派生，不直接复用：同一个 V3 文档可能正被画布节点引用，
 * 直接复用会让打开的工作副本覆盖画布里的那份。派生结果稳定，扫描能认出是同一份文件。
 */
export function legacyImageDocumentHeader(envelope: ImageEditDocumentEnvelope, createdAt: string): HenjiImageDocumentHeader {
  const digest = crypto.createHash('sha256').update(`henjiimg-legacy:${envelope.documentId}`).digest('hex')
  const created = Number.isNaN(Date.parse(createdAt)) ? envelope.createdAt : createdAt
  return {
    format: IMAGE_DOCUMENT_HEADER_FORMAT,
    version: IMAGE_DOCUMENT_HEADER_VERSION,
    id: `img-${digest.slice(0, 32)}`,
    draft: false,
    revision: 0,
    kindVersion: IMAGE_DOCUMENT_KIND_VERSION,
    createdAt: created,
    updatedAt: envelope.updatedAt,
    contentRevision: envelope.revision,
    emptyUntilRevision: null,
    summary: summarizeImageEditDocument(envelope.document),
  }
}

/** 包内 V3 文档换成新的 ID（副本换 ID、旧包导入工作副本时用）。 */
export function withImageEditDocumentId(envelope: ImageEditDocumentEnvelope, documentId: string): ImageEditDocumentEnvelope {
  if (envelope.documentId === documentId) return envelope
  const body = isRecord(envelope.document) ? { ...envelope.document, id: documentId } : envelope.document
  return {
    ...envelope,
    documentId,
    document: body,
    ...(envelope.history ? { history: { ...envelope.history, documentId } } : {}),
  }
}
