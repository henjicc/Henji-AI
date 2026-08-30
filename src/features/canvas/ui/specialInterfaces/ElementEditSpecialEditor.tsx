import { useStoreWithEqualityFn } from 'zustand/traditional'

import { UiButton, UiError } from '@/components/ui'
import { UiModal } from '@/components/ui/UiModal'
import { persistImageSource } from '@/commands/image'
import { createLogger } from '@/core/logging'
import {
  areStringListsEqual,
  collectInputMediaUrls,
} from '@/features/canvas/application/graphMediaResolver'
import { MaskEditorModal, parseMaskEditorDocument, type MaskEditorResult } from '@/features/maskEditor'
import { useCanvasStore } from '@/stores/canvasStore'
import type { CanvasSpecialEditorSurfaceProps } from './specialEditorRegistry'

const logger = createLogger('features.canvas.local-redraw-mask-editor')

function normalizeInlineImages(state: Readonly<DynamicValueMap>): string[] {
  const mediaInputs = state.mediaInputs && typeof state.mediaInputs === 'object'
    ? state.mediaInputs as DynamicValueMap
    : {}
  return Array.isArray(mediaInputs.image)
    ? mediaInputs.image.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

export default function ElementEditSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const incomingImages = useStoreWithEqualityFn(
    useCanvasStore,
    (state) => collectInputMediaUrls(session.nodeId, state.nodes, state.edges, 'image'),
    areStringListsEqual,
  )
  const images = incomingImages.length > 0 ? incomingImages : normalizeInlineImages(session.draftState)
  const sourceImage = images.length === 1 ? images[0] : null

  if (!sourceImage) {
    return (
      <UiModal
        isOpen
        title="局部重绘"
        size="compact"
        onClose={onCancel}
        footer={<UiButton type="button" variant="primary" size="sm" onClick={onCancel}>返回画布</UiButton>}
      >
        <UiError title="无法打开遮罩编辑器" message="局部重绘必须且只能连接一张源图。" />
      </UiModal>
    )
  }

  const handleConfirm = async (result: MaskEditorResult): Promise<void> => {
    const startedAt = performance.now()
    logger.info('局部重绘遮罩保存开始', { event: 'canvas.local_redraw.mask.persist.start' })
    try {
      const maskSource = await persistImageSource(result.maskDataUrl)
      onDraftChange({
        ...session.draftState,
        localRedrawMaskSource: maskSource,
        localRedrawMaskDocument: result.document,
      })
      onConfirm()
      logger.info('局部重绘遮罩保存完成', {
        event: 'canvas.local_redraw.mask.persist.completed',
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    } catch (error) {
      logger.error('局部重绘遮罩保存失败', {
        event: 'canvas.local_redraw.mask.persist.failed',
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      })
      throw error
    }
  }

  return (
    <MaskEditorModal
      isOpen
      sourceImage={sourceImage}
      initialDocument={parseMaskEditorDocument(session.draftState.localRedrawMaskDocument)}
      onCancel={onCancel}
      onConfirm={handleConfirm}
    />
  )
}
