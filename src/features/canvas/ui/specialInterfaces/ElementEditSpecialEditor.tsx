import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useTranslation } from 'react-i18next'

import { UiButton, UiError } from '@/components/ui'
import { UiModal } from '@/components/ui/UiModal'
import { persistImageSource } from '@/commands/image'
import { createLogger } from '@/core/logging'
import {
  areStringListsEqual,
  collectInputMediaUrls,
} from '@/features/canvas/application/graphMediaResolver'
import { MaskEditorModal, parseMaskEditorDocument, type MaskEditorResult } from '@/features/maskEditor'
import { canvasViewStore } from '@/stores/canvasStore'
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
  const { t } = useTranslation()
  const incomingImages = useStoreWithEqualityFn(
    canvasViewStore,
    (state) => collectInputMediaUrls(session.nodeId, state.nodes, state.edges, 'image'),
    areStringListsEqual,
  )
  const images = incomingImages.length > 0 ? incomingImages : normalizeInlineImages(session.draftState)
  const sourceImage = images.length === 1 ? images[0] : null

  if (!sourceImage) {
    return (
      <UiModal
        isOpen
        title={t('node.elementEditEditor.title')}
        size="compact"
        onClose={onCancel}
        footer={<UiButton type="button" variant="secondary" onClick={onCancel}>{t('node.backToCanvas')}</UiButton>}
      >
        <UiError title={t('node.elementEditEditor.openFailed')} message={t('node.elementEditEditor.sourceRequired')} />
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
