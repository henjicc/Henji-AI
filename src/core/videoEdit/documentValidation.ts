import { createIncrementalSchemaParser } from '../incrementalSchemaParse'
import { videoEditDocumentSchema, type VideoEditDocument } from './document'

const parser = createIncrementalSchemaParser<VideoEditDocument>(videoEditDocumentSchema)

/**
 * 剪辑文档的完整校验，结果与 `videoEditDocumentSchema.parse` 相同；与 `base` 同一引用且校验过的子树直接沿用，
 * 结果深度冻结（做法见 `createIncrementalSchemaParser`）。
 */
export function parseVideoEditDocument(value: unknown, base?: VideoEditDocument, onUnexpectedFallback?: (error: unknown) => void): VideoEditDocument {
  return parser.parse(value, base, onUnexpectedFallback)
}

/** 冻结只保护共享引用，不授予校验信任；外部的浅冻结对象仍需遍历子树。 */
export function freezeVideoEditDocument<T>(value: T): T {
  return parser.freeze(value)
}
