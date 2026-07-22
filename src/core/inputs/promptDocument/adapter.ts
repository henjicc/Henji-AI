import { createLogger } from '@/core/logging'
import { normalizePromptDocument } from './normalize'
import { parseLegacyPromptString } from './parser'
import { toLegacyPromptString } from './serializer'
import type {
  LegacyPromptParseOptions,
  PromptDocumentSerializationContext,
} from './serializationTypes'
import type { PromptDocumentV1 } from './types'
import {
  validatePromptDocumentV1,
  type PromptDocumentValidationReason,
} from './validation'

export interface PromptDocumentFallbackDiagnostic {
  event: 'prompt_document.parse.fallback'
  carrierType: string
  carrierId?: string
  reason: PromptDocumentValidationReason
  documentVersion?: string | number | null
}

export interface ReadPromptDocumentInput {
  document?: unknown
  legacyText: string
}

export interface ReadPromptDocumentOptions extends LegacyPromptParseOptions {
  carrierType?: string
  carrierId?: string
  reportFallback?: (diagnostic: PromptDocumentFallbackDiagnostic) => void
}

export interface ReadPromptDocumentResult {
  document: PromptDocumentV1
  source: 'document' | 'legacy'
  fallback?: PromptDocumentFallbackDiagnostic
}

export interface PromptDocumentDoubleWrite {
  document: PromptDocumentV1
  legacyText: string
}

export function reportPromptDocumentFallback(
  diagnostic: PromptDocumentFallbackDiagnostic,
): void {
  createLogger('core.inputs.promptDocument').warn(
    '提示词文档解析失败，已回退兼容字符串',
    diagnostic,
  )
}

export function readPromptDocument(
  input: ReadPromptDocumentInput,
  options: ReadPromptDocumentOptions = {},
): ReadPromptDocumentResult {
  const validation = validatePromptDocumentV1(input.document)
  if (validation.valid) {
    return {
      document: normalizePromptDocument(validation.document),
      source: 'document',
    }
  }

  const document = parseLegacyPromptString(input.legacyText, options)
  if (input.document === undefined) return { document, source: 'legacy' }

  const fallback: PromptDocumentFallbackDiagnostic = {
    event: 'prompt_document.parse.fallback',
    carrierType: options.carrierType ?? 'unknown',
    ...(options.carrierId ? { carrierId: options.carrierId } : {}),
    reason: validation.reason,
    ...(validation.documentVersion !== undefined
      ? { documentVersion: validation.documentVersion }
      : {}),
  }
  const reporter = options.reportFallback ?? reportPromptDocumentFallback
  reporter(fallback)
  return { document, source: 'legacy', fallback }
}

export function createPromptDocumentDoubleWrite(
  document: PromptDocumentV1,
  context: PromptDocumentSerializationContext = {},
): PromptDocumentDoubleWrite {
  const normalized = normalizePromptDocument(document)
  return {
    document: normalized,
    legacyText: toLegacyPromptString(normalized, context),
  }
}
