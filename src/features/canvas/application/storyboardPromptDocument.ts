import {
  compactPromptMediaReferenceSpacing,
  readPromptDocument,
  toLegacyPromptString,
  type LegacyPromptReference,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

export interface StoryboardPromptDocumentCarrier {
  document?: unknown
  legacyText: string
  carrierType: 'storyboard-gen-frame' | 'storyboard-split-note'
  carrierId: string
  references: readonly LegacyPromptReference[]
}

export interface ResolvedStoryboardPromptDocument {
  document: PromptDocumentV1
  legacyText: string
  referenceIndex: number | null
}

export function resolveStoryboardPromptReferenceIndex(
  document: PromptDocumentV1,
  references: readonly LegacyPromptReference[],
): number | null {
  for (const paragraph of document.content) {
    for (const node of paragraph.content ?? []) {
      if (node.type !== 'mediaReference') continue
      const index = references.findIndex((reference) => (
        reference.resourceId === node.attrs.resourceId
      ))
      if (index >= 0) return index
    }
  }
  return null
}

export function resolveStoryboardPromptDocument({
  document,
  legacyText,
  carrierType,
  carrierId,
  references,
}: StoryboardPromptDocumentCarrier): ResolvedStoryboardPromptDocument {
  const resolvedDocument = compactPromptMediaReferenceSpacing(readPromptDocument(
    { document, legacyText },
    { carrierType, carrierId, references },
  ).document)
  return {
    document: resolvedDocument,
    legacyText: toLegacyPromptString(resolvedDocument, { references }),
    referenceIndex: resolveStoryboardPromptReferenceIndex(resolvedDocument, references),
  }
}

export function storyboardPromptDocumentsEqual(
  left: PromptDocumentV1 | undefined,
  right: PromptDocumentV1,
): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right)
}
