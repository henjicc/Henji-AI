import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiFormRow, UiGroup, UiInput, UiRangeInput, UiTextArea } from '@/components/ui'
import type { ImageEditAnnotationLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { useImageEditorInteractionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorAnnotationPreviewV3 } from './useImageEditorAnnotationPreviewV3'

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
  const committedAnnotation = selection?.layerId === layer.id
    ? layer.annotations.find(({ id }) => id === selection.annotationId)
    : undefined
  const annotationPreview = useImageEditorAnnotationPreviewV3(
    controller,
    selection?.layerId ?? null,
    committedAnnotation ?? null,
  )
  const annotation = annotationPreview.annotation ?? undefined
  const [text, setText] = useState('')
  const cancelBlurRef = useRef(false)

  useEffect(() => {
    setText(annotation?.type === 'text'
      ? annotation.text
      : annotation && 'label' in annotation
        ? annotation.label ?? ''
        : '')
  }, [annotation])

  if (!selection || !annotation) return null

  const commitText = (): void => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false
      return
    }
    if (locked) return
    const current = annotation.type === 'text'
      ? annotation.text
      : 'label' in annotation
        ? annotation.label ?? ''
        : null
    if (current === null || text === current) return
    if (annotation.type === 'text') {
      controller.updateAnnotation(layer.id, annotation.id, { ...annotation, text })
    } else if ('label' in annotation) {
      controller.updateAnnotation(layer.id, annotation.id, { ...annotation, label: text })
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
      {annotation.type === 'text' || 'label' in annotation ? (
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
                setText(annotation.type === 'text' ? annotation.text : annotation.label ?? '')
                event.currentTarget.blur()
              }
            }}
          />
        </UiFormRow>
      ) : null}
      {'stroke' in annotation || 'color' in annotation ? (
        <UiFormRow label={t('imageEditor.v3.toolSettings.color')} inline>
          <UiInput
            className="!h-8 !w-10 !p-1"
            type="color"
            aria-label={t('imageEditor.v3.toolSettings.color')}
            disabled={locked}
            value={'stroke' in annotation ? annotation.stroke : annotation.color}
            onChange={(event) => {
              annotationPreview.update(
                'stroke' in annotation
                  ? { ...annotation, stroke: event.currentTarget.value }
                  : { ...annotation, color: event.currentTarget.value },
              )
              queueMicrotask(annotationPreview.commit)
            }}
          />
        </UiFormRow>
      ) : null}
      {'lineWidth' in annotation ? (
        <UiFormRow label={t('imageEditor.v3.toolSettings.strokeWidth')}>
          <UiRangeInput
            aria-label={t('imageEditor.v3.toolSettings.strokeWidth')}
            min={1}
            max={64}
            disabled={locked}
            value={annotation.lineWidth}
            onChange={(event) => annotationPreview.update({
              ...annotation,
              lineWidth: Number(event.currentTarget.value),
            })}
            onPointerUp={annotationPreview.commit}
            onPointerCancel={annotationPreview.cancel}
            onBlur={annotationPreview.commit}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                annotationPreview.commit()
              }
            }}
          />
        </UiFormRow>
      ) : null}
      {'fontSize' in annotation ? (
        <UiFormRow label={t('imageEditor.v3.toolSettings.fontSize')}>
          <UiRangeInput
            aria-label={t('imageEditor.v3.toolSettings.fontSize')}
            min={8}
            max={256}
            disabled={locked}
            value={annotation.fontSize}
            onChange={(event) => annotationPreview.update({
              ...annotation,
              fontSize: Number(event.currentTarget.value),
            })}
            onPointerUp={annotationPreview.commit}
            onPointerCancel={annotationPreview.cancel}
            onBlur={annotationPreview.commit}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                annotationPreview.commit()
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
