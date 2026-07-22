import type {
  PromptDocumentV1,
  PromptInlineNodeV1,
  PromptParagraphV1,
} from './types'

export type PromptDocumentValidationReason =
  | 'not_object'
  | 'unknown_version'
  | 'invalid_document'
  | 'invalid_paragraph'
  | 'invalid_inline_node'
  | 'invalid_media_reference'
  | 'invalid_template_variable'

export type PromptDocumentValidationResult =
  | { valid: true; document: PromptDocumentV1 }
  | {
      valid: false
      reason: PromptDocumentValidationReason
      documentVersion?: string | number | null
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function describeDocumentVersion(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number' || value === null) return value
  return typeof value
}

function validateMediaReference(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, ['type', 'attrs']) || !isRecord(value.attrs)) return false
  const attrs = value.attrs
  if (!hasOnlyKeys(attrs, ['resourceId', 'mediaType', 'fallbackLabel', 'sourceNodeId'])) {
    return false
  }
  const mediaType = attrs.mediaType
  return isNonEmptyString(attrs.resourceId)
    && (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio')
    && isNonEmptyString(attrs.fallbackLabel)
    && (attrs.sourceNodeId === undefined || isNonEmptyString(attrs.sourceNodeId))
}

function validateTemplateVariable(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, ['type', 'attrs']) || !isRecord(value.attrs)) return false
  const attrs = value.attrs
  return hasOnlyKeys(attrs, ['key', 'fallbackLabel'])
    && isNonEmptyString(attrs.key)
    && isNonEmptyString(attrs.fallbackLabel)
}

function validateInlineNode(value: unknown): PromptInlineNodeV1 | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'text') {
    return hasOnlyKeys(value, ['type', 'text']) && typeof value.text === 'string'
      ? value as unknown as PromptInlineNodeV1
      : null
  }
  if (value.type === 'hardBreak') {
    return hasOnlyKeys(value, ['type']) ? { type: 'hardBreak' } : null
  }
  if (value.type === 'mediaReference') {
    return validateMediaReference(value) ? value as unknown as PromptInlineNodeV1 : null
  }
  if (value.type === 'templateVariable') {
    return validateTemplateVariable(value) ? value as unknown as PromptInlineNodeV1 : null
  }
  return null
}

function validateParagraph(value: unknown): PromptParagraphV1 | null {
  if (!isRecord(value) || value.type !== 'paragraph') return null
  if (!hasOnlyKeys(value, ['type', 'content'])) return null
  if (value.content === undefined) return { type: 'paragraph' }
  if (!Array.isArray(value.content)) return null

  const content = value.content.map(validateInlineNode)
  if (content.some((node) => node === null)) return null
  return {
    type: 'paragraph',
    ...(content.length ? { content: content as PromptInlineNodeV1[] } : {}),
  }
}

export function validatePromptDocumentV1(value: unknown): PromptDocumentValidationResult {
  if (!isRecord(value)) return { valid: false, reason: 'not_object' }
  if (value.version !== 1) {
    return {
      valid: false,
      reason: 'unknown_version',
      ...(Object.prototype.hasOwnProperty.call(value, 'version')
        ? { documentVersion: describeDocumentVersion(value.version) }
        : {}),
    }
  }
  if (!hasOnlyKeys(value, ['version', 'type', 'content'])) {
    return { valid: false, reason: 'invalid_document', documentVersion: 1 }
  }
  if (value.type !== 'doc' || !Array.isArray(value.content)) {
    return { valid: false, reason: 'invalid_document', documentVersion: 1 }
  }

  const content = value.content.map(validateParagraph)
  if (content.some((paragraph) => paragraph === null)) {
    return { valid: false, reason: 'invalid_paragraph', documentVersion: 1 }
  }

  return {
    valid: true,
    document: {
      version: 1,
      type: 'doc',
      content: content as PromptParagraphV1[],
    },
  }
}

export function isPromptDocumentV1(value: unknown): value is PromptDocumentV1 {
  return validatePromptDocumentV1(value).valid
}
