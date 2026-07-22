export interface PromptDocumentReferenceLabel {
  resourceId: string
  label: string
}

export interface PromptDocumentSerializationContext {
  references?: readonly PromptDocumentReferenceLabel[]
  resolveReferenceLabel?: (resourceId: string) => string | undefined
}

export interface LegacyPromptReference extends PromptDocumentReferenceLabel {
  mediaType: 'image' | 'video' | 'audio'
  sourceNodeId?: string
}

export interface LegacyPromptVariable {
  key: string
  label: string
}

export interface LegacyPromptParseOptions {
  references?: readonly LegacyPromptReference[]
  variables?: readonly LegacyPromptVariable[]
}
