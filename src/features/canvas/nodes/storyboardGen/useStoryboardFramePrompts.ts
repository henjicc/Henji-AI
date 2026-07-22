import { useCallback, useEffect, useMemo } from 'react'

import type { PromptReferenceItem } from '@/components/ui'
import { createEmptyPromptDocument, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import {
  promptMediaBindingsEqual,
  resolveCanvasGenerationPrompt,
} from '@/features/canvas/application/generationPromptDocument'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import {
  resolveStoryboardPromptDocument,
  storyboardPromptDocumentsEqual,
} from '@/features/canvas/application/storyboardPromptDocument'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import type { NodeMediaOutput } from '@/features/canvas/domain/nodePorts'
import { useCanvasStore } from '@/stores/canvasStore'

interface UseStoryboardFramePromptsParams {
  nodeId: string
  data: StoryboardGenNodeData
  incomingImages: readonly NodeMediaOutput[]
}

export interface UseStoryboardFramePromptsResult {
  frameDocuments: Readonly<Record<string, PromptDocumentV1>>
  references: readonly PromptReferenceItem[]
  effectiveImages: string[]
  onImageInputChange: (values: string[]) => void
  onFrameDocumentChange: (
    index: number,
    document: PromptDocumentV1,
    historyGroup: string,
  ) => void
}

function toPromptReferenceItems(
  references: ReturnType<typeof resolveCanvasGenerationPrompt>['references'],
): PromptReferenceItem[] {
  return references.map((reference) => ({
    resourceId: reference.resourceId,
    mediaType: reference.mediaType,
    label: reference.label,
    legacyLabels: reference.legacyLabels,
    thumbnailSrc: resolveImageDisplayUrl(reference.previewUrl ?? reference.mediaUrl),
    ...(reference.sourceNodeId ? { sourceNodeId: reference.sourceNodeId } : {}),
  }))
}

export function useStoryboardFramePrompts({
  nodeId,
  data,
  incomingImages,
}: UseStoryboardFramePromptsParams): UseStoryboardFramePromptsResult {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const mediaInputs = useMemo(() => data.mediaInputs ?? {}, [data.mediaInputs])
  const mediaCarrier = useMemo(() => resolveCanvasGenerationPrompt({
    nodeId,
    document: createEmptyPromptDocument(),
    legacyText: '',
    bindings: data.promptMediaBindings,
    mediaInputs,
    incomingMedia: incomingImages,
    acceptedMediaKinds: ['image'],
  }), [data.promptMediaBindings, incomingImages, mediaInputs, nodeId])
  const references = useMemo(
    () => toPromptReferenceItems(mediaCarrier.references),
    [mediaCarrier.references],
  )
  const resolvedFrames = useMemo(() => data.frames.map((frame) => {
    const resolved = resolveStoryboardPromptDocument({
      document: frame.descriptionDocument,
      legacyText: frame.description ?? '',
      carrierType: 'storyboard-gen-frame',
      carrierId: `${nodeId}:${frame.id}`,
      references,
    })
    return {
      ...frame,
      descriptionDocument: resolved.document,
      description: resolved.legacyText,
      referenceIndex: resolved.referenceIndex,
    }
  }), [data.frames, nodeId, references])

  useEffect(() => {
    const bindingsChanged = !promptMediaBindingsEqual(
      data.promptMediaBindings,
      mediaCarrier.bindings,
    )
    const framesChanged = resolvedFrames.some((frame, index) => {
      const current = data.frames[index]
      return !current
        || current.description !== frame.description
        || current.referenceIndex !== frame.referenceIndex
        || !storyboardPromptDocumentsEqual(current.descriptionDocument, frame.descriptionDocument)
    })
    if (!bindingsChanged && !framesChanged) return
    updateNodeData(nodeId, {
      promptMediaBindings: mediaCarrier.bindings,
      frames: resolvedFrames,
    }, { skipHistory: true })
  }, [
    data.frames,
    data.promptMediaBindings,
    mediaCarrier.bindings,
    nodeId,
    resolvedFrames,
    updateNodeData,
  ])

  const onImageInputChange = useCallback((values: string[]): void => {
    const nextMediaInputs = { ...mediaInputs, image: values }
    const nextCarrier = resolveCanvasGenerationPrompt({
      nodeId,
      document: createEmptyPromptDocument(),
      legacyText: '',
      bindings: data.promptMediaBindings,
      mediaInputs: nextMediaInputs,
      incomingMedia: incomingImages,
      acceptedMediaKinds: ['image'],
    })
    const nextReferences = toPromptReferenceItems(nextCarrier.references)
    const nextFrames = data.frames.map((frame) => {
      const resolved = resolveStoryboardPromptDocument({
        document: frame.descriptionDocument,
        legacyText: frame.description ?? '',
        carrierType: 'storyboard-gen-frame',
        carrierId: `${nodeId}:${frame.id}`,
        references: nextReferences,
      })
      return {
        ...frame,
        descriptionDocument: resolved.document,
        description: resolved.legacyText,
        referenceIndex: resolved.referenceIndex,
      }
    })
    updateNodeData(nodeId, {
      mediaInputs: nextMediaInputs,
      promptMediaBindings: nextCarrier.bindings,
      frames: nextFrames,
    })
  }, [data.frames, data.promptMediaBindings, incomingImages, mediaInputs, nodeId, updateNodeData])

  const onFrameDocumentChange = useCallback((
    index: number,
    document: PromptDocumentV1,
    historyGroup: string,
  ): void => {
    const frame = data.frames[index]
    if (!frame) return
    const resolved = resolveStoryboardPromptDocument({
      document,
      legacyText: frame.description ?? '',
      carrierType: 'storyboard-gen-frame',
      carrierId: `${nodeId}:${frame.id}`,
      references,
    })
    const nextFrames = [...data.frames]
    nextFrames[index] = {
      ...frame,
      descriptionDocument: resolved.document,
      description: resolved.legacyText,
      referenceIndex: resolved.referenceIndex,
    }
    updateNodeData(nodeId, { frames: nextFrames }, { historyGroup })
  }, [data.frames, nodeId, references, updateNodeData])

  const frameDocuments = useMemo(() => Object.fromEntries(
    resolvedFrames.map((frame) => [frame.id, frame.descriptionDocument]),
  ), [resolvedFrames])

  return {
    frameDocuments,
    references,
    effectiveImages: mediaCarrier.mediaUrls.image,
    onImageInputChange,
    onFrameDocumentChange,
  }
}
