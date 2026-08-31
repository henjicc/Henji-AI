import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiFormRow, UiGroup, UiTextArea } from '@/components/ui'
import type { ImageEditAnnotationLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { useImageEditorInteractionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'

export function ImageEditorAnnotationPropertiesV3({
  controller,
  layer,
  locked,
}: {
  controller: ImageEditorV3Controller
  layer: ImageEditAnnotationLayerV3
  locked: boolean
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const selection = useImageEditorInteractionStoreV3(
    (state) => state.annotationSelectionBySession[controller.sessionId],
  )
  const selectAnnotation = useImageEditorInteractionStoreV3((state) => state.selectAnnotation)
  const annotation = selection?.layerId === layer.id
    ? layer.annotations.find(({ id }) => id === selection.annotationId)
    : undefined
  const [text, setText] = useState('')
  const cancelBlurRef = useRef(false)

  useEffect(() => {
    setText(annotation?.type === 'text' ? annotation.text : '')
  }, [annotation])

  if (!selection || !annotation) return null

  const commitText = (): void => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      return
    }
    if (annotation.type !== 'text' || locked) return
    if (text !== annotation.text) {
      controller.updateAnnotation(layer.id, annotation.id, { ...annotation, text })
    }
  }

  const remove = (): void => {
    if (locked) return
    controller.deleteAnnotation(layer.id, annotation.id)
    selectAnnotation(controller.sessionId, null)
  }

  return (
    <UiGroup
      divided
      className="mt-5"
      title={t('imageEditor.v3.annotation.properties')}
      gap="stack"
    >
      <p className="text-xs text-text-muted">
        {t(`imageEditor.v3.annotation.type.${annotation.type}`)}
      </p>
      {annotation.type === 'text' ? (
        <UiFormRow label={t('imageEditor.v3.annotation.text')}>
          <UiTextArea
            aria-label={t('imageEditor.v3.annotation.text')}
            rows={3}
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.currentTarget.value)}
            onBlur={commitText}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.currentTarget.blur()
              } else if (event.key === 'Escape') {
                cancelBlurRef.current = true
                setText(annotation.text)
                event.currentTarget.blur()
              }
            }}
          />
        </UiFormRow>
      ) : null}
      <UiButton
        variant="plain"
        size="sm"
        className="justify-start gap-2 text-danger"
        disabled={locked}
        onClick={remove}
      >
        <Trash2 className="h-4 w-4" />
        {t('imageEditor.v3.annotation.delete')}
      </UiButton>
    </UiGroup>
  )
}
