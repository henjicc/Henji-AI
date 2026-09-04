import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import {
  useImageEditorRasterPasteboardV3,
  type ImageEditorRasterPasteboardV3State,
} from './useImageEditorRasterPasteboardV3'

interface ImageEditorRasterPasteboardPresentationV3Options {
  document: ImageEditDocumentV3
  sourceImageUrl: string
  documentWidth: number
  enabled: boolean
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[]
  previewOverrides: ImageEditCommandBusSnapshotV3['previewOverrides']
  displayDocumentId: string
  displayRevision: number
  stablePreviewDocumentId: string | null
  stablePreviewRevision: number | null
  gpuPresentationActive: boolean
}

interface ImageEditorRasterPasteboardPresentationV3 {
  stableDisplayRef: RefObject<HTMLDivElement>
  pasteboard: ImageEditorRasterPasteboardV3State
}

/**
 * DOM 栅格栈先接管拖动反馈；提交后先清手势残差，再等同 revision 稳定帧原子接回。
 */
export function useImageEditorRasterPasteboardPresentationV3({
  document,
  sourceImageUrl,
  documentWidth,
  enabled,
  resourceDescriptors,
  previewOverrides,
  displayDocumentId,
  displayRevision,
  stablePreviewDocumentId,
  stablePreviewRevision,
  gpuPresentationActive,
}: ImageEditorRasterPasteboardPresentationV3Options): ImageEditorRasterPasteboardPresentationV3 {
  const stableDisplayRef = useRef<HTMLDivElement | null>(null)
  const stableDisplayReady = stablePreviewDocumentId === displayDocumentId
    && stablePreviewRevision === displayRevision
  const pasteboard = useImageEditorRasterPasteboardV3(
    document,
    sourceImageUrl,
    documentWidth,
    enabled,
    resourceDescriptors,
    stableDisplayRef,
    stableDisplayReady,
    gpuPresentationActive,
  )
  const {
    alwaysVisible,
    clearMoveFeedback,
    completeStableHandoff,
    ready,
  } = pasteboard

  useLayoutEffect(() => {
    if (!ready) return
    // React 已把权威 transform 写进每层基础矩阵，可以在同一布局阶段清除手势残差。
    clearMoveFeedback()
    if (alwaysVisible) {
      completeStableHandoff()
      return
    }
    if (
      Object.keys(previewOverrides).length > 0
      || stablePreviewDocumentId !== displayDocumentId
      || stablePreviewRevision !== displayRevision
    ) return
    completeStableHandoff()
  }, [
    alwaysVisible,
    clearMoveFeedback,
    completeStableHandoff,
    displayDocumentId,
    displayRevision,
    previewOverrides,
    ready,
    stablePreviewDocumentId,
    stablePreviewRevision,
  ])

  return { stableDisplayRef, pasteboard }
}
