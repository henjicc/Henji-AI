import {
  compactPromptMediaReferenceSpacing,
  createLegacyPromptMediaLabels,
  createPromptMediaLabel,
  readPromptDocument,
  toLegacyPromptString,
  validatePromptDocumentV1,
  type PromptDocumentV1,
  type PromptMediaBinding,
  type PromptMediaType,
} from '@/core/inputs/promptDocument'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'
import type { NodeMediaOutput } from '@/features/canvas/domain/nodePorts'

export interface CanvasPromptReference {
  resourceId: string
  mediaType: PromptMediaType
  label: string
  legacyLabels: readonly string[]
  mediaUrl: string
  previewUrl?: string | null
  sourceNodeId?: string
}

export interface CanvasGenerationPromptCarrier {
  nodeId: string
  document?: unknown
  legacyText: string
  bindings?: unknown
  mediaInputs: Partial<Record<RowMediaKind, string[]>>
  incomingMedia: readonly NodeMediaOutput[]
  acceptedMediaKinds: readonly RowMediaKind[]
}

export interface ResolvedCanvasGenerationPrompt {
  document: PromptDocumentV1
  legacyText: string
  references: CanvasPromptReference[]
  bindings: PromptMediaBinding[]
  mediaUrls: Record<RowMediaKind, string[]>
}

type LocalResourceIdFactory = (nodeId: string) => string

const MEDIA_KINDS: readonly RowMediaKind[] = ['image', 'video', 'audio']

function defaultLocalResourceIdFactory(nodeId: string): string {
  return `canvas-local:${nodeId}:${globalThis.crypto.randomUUID()}`
}

export function isCanvasPromptMediaBinding(value: unknown): value is PromptMediaBinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PromptMediaBinding>
  return typeof candidate.resourceId === 'string'
    && candidate.resourceId.trim().length > 0
    && MEDIA_KINDS.includes(candidate.mediaType as RowMediaKind)
    && (typeof candidate.dataUrl === 'string' || typeof candidate.filePath === 'string')
}

function readBindings(value: unknown): PromptMediaBinding[] {
  return Array.isArray(value) ? value.filter(isCanvasPromptMediaBinding) : []
}

function createOutputResourceId(output: NodeMediaOutput, fallbackIndex: number): string {
  const sourceNodeId = output.sourceNodeId ?? 'unknown'
  const sourceHandle = output.sourceHandle ?? 'source'
  const outputIndex = output.outputIndex ?? fallbackIndex
  return `canvas-output:${sourceNodeId}:${sourceHandle}:${outputIndex}`
}

function createRebasedLocalResourceId(
  nodeId: string,
  resourceId: string,
  createResourceId: LocalResourceIdFactory,
): string {
  const parts = resourceId.split(':')
  if (parts[0] === 'canvas-local' && parts.length >= 3) {
    return `canvas-local:${nodeId}:${parts.slice(2).join(':')}`
  }
  return createResourceId(nodeId)
}

function remapDocumentResourceIds(
  document: PromptDocumentV1,
  resourceIdMap: ReadonlyMap<string, string>,
): PromptDocumentV1 {
  if (resourceIdMap.size === 0) return document
  let changed = false
  const content = document.content.map((paragraph) => ({
    ...paragraph,
    ...(paragraph.content ? {
      content: paragraph.content.map((node) => {
        if (node.type !== 'mediaReference') return node
        const resourceId = resourceIdMap.get(node.attrs.resourceId)
        if (!resourceId || resourceId === node.attrs.resourceId) return node
        changed = true
        return { ...node, attrs: { ...node.attrs, resourceId } }
      }),
    } : {}),
  }))
  return changed ? { ...document, content } : document
}

function reconcileLocalBindings(
  nodeId: string,
  mediaType: RowMediaKind,
  urls: readonly string[],
  storedBindings: readonly PromptMediaBinding[],
  resourceIdMap: Map<string, string>,
  createResourceId: LocalResourceIdFactory,
): PromptMediaBinding[] {
  const availableByUrl = new Map<string, PromptMediaBinding[]>()
  storedBindings
    .filter((binding) => binding.mediaType === mediaType)
    .forEach((binding) => {
      const value = binding.dataUrl ?? binding.filePath
      if (!value) return
      const available = availableByUrl.get(value) ?? []
      available.push(binding)
      availableByUrl.set(value, available)
    })

  return urls.map((url) => {
    const matched = availableByUrl.get(url)?.shift()
    if (!matched) {
      return {
        resourceId: createResourceId(nodeId),
        mediaType,
        dataUrl: url,
      }
    }

    const expectedPrefix = `canvas-local:${nodeId}:`
    const resourceId = matched.resourceId.startsWith(expectedPrefix)
      ? matched.resourceId
      : createRebasedLocalResourceId(nodeId, matched.resourceId, createResourceId)
    if (resourceId !== matched.resourceId) {
      resourceIdMap.set(matched.resourceId, resourceId)
    }
    return {
      ...matched,
      resourceId,
      mediaType,
      dataUrl: url,
    }
  })
}

export function resolveCanvasGenerationPrompt(
  carrier: CanvasGenerationPromptCarrier,
  createResourceId: LocalResourceIdFactory = defaultLocalResourceIdFactory,
): ResolvedCanvasGenerationPrompt {
  const accepted = new Set(carrier.acceptedMediaKinds)
  const storedBindings = readBindings(carrier.bindings)
  const resourceIdMap = new Map<string, string>()
  const references: CanvasPromptReference[] = []
  const bindings: PromptMediaBinding[] = []
  const mediaUrls: Record<RowMediaKind, string[]> = { image: [], video: [], audio: [] }

  MEDIA_KINDS.forEach((mediaType) => {
    if (!accepted.has(mediaType)) return
    const localUrls = carrier.mediaInputs[mediaType] ?? []
    const localBindings = reconcileLocalBindings(
      carrier.nodeId,
      mediaType,
      localUrls,
      storedBindings,
      resourceIdMap,
      createResourceId,
    )
    bindings.push(...localBindings)
    const incoming = carrier.incomingMedia.filter((output) => output.kind === mediaType)
    if (incoming.length > 0) {
      incoming.forEach((output, index) => {
        mediaUrls[mediaType].push(output.url)
        references.push({
          resourceId: createOutputResourceId(output, index),
          mediaType,
          label: createPromptMediaLabel(mediaType, index + 1),
          legacyLabels: createLegacyPromptMediaLabels(mediaType, index + 1),
          mediaUrl: output.url,
          previewUrl: output.previewUrl,
          ...(output.sourceNodeId ? { sourceNodeId: output.sourceNodeId } : {}),
        })
      })
      return
    }

    mediaUrls[mediaType] = [...localUrls]
    localBindings.forEach((binding, index) => {
      references.push({
        resourceId: binding.resourceId,
        mediaType,
        label: createPromptMediaLabel(mediaType, index + 1),
        legacyLabels: createLegacyPromptMediaLabels(mediaType, index + 1),
        mediaUrl: binding.dataUrl ?? binding.filePath ?? '',
      })
    })
  })

  const resolved = readPromptDocument(
    { document: carrier.document, legacyText: carrier.legacyText },
    {
      carrierType: 'canvas-generation-node',
      carrierId: carrier.nodeId,
      references,
    },
  )
  const document = compactPromptMediaReferenceSpacing(
    remapDocumentResourceIds(resolved.document, resourceIdMap),
  )
  return {
    document,
    legacyText: toLegacyPromptString(document, { references }),
    references,
    bindings,
    mediaUrls,
  }
}

export function rebaseCanvasLocalPromptData(
  data: DynamicValueMap,
  sourceNodeId: string,
  targetNodeId: string,
): DynamicValueMap | null {
  const bindings = readBindings(data.promptMediaBindings)
  const sourcePrefix = `canvas-local:${sourceNodeId}:`
  const resourceIdMap = new Map<string, string>()
  const nextBindings = bindings.map((binding) => {
    if (!binding.resourceId.startsWith(sourcePrefix)) return binding
    const resourceId = `canvas-local:${targetNodeId}:${binding.resourceId.slice(sourcePrefix.length)}`
    resourceIdMap.set(binding.resourceId, resourceId)
    return { ...binding, resourceId }
  })
  if (resourceIdMap.size === 0) return null

  const validation = validatePromptDocumentV1(data.promptDocument)
  return {
    promptMediaBindings: nextBindings,
    ...(validation.valid
      ? { promptDocument: remapDocumentResourceIds(validation.document, resourceIdMap) }
      : {}),
  }
}

export function promptDocumentsEqual(
  left: PromptDocumentV1 | undefined,
  right: PromptDocumentV1,
): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right)
}

export function promptMediaBindingsEqual(
  left: unknown,
  right: readonly PromptMediaBinding[],
): boolean {
  return Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right)
}
