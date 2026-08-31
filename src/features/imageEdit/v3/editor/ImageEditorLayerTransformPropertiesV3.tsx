import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiFormRow, UiGroup, UiInput } from '@/components/ui'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3'

import {
  composeImageEditTransformV3,
  decomposeImageEditTransformV3,
  type ImageEditTransformFieldsV3,
} from './layerTransformV3'
import type { ImageEditorV3Controller } from './types'

type TransformFieldV3 = Exclude<keyof ImageEditTransformFieldsV3, 'shear'>

const FIELD_KEYS: readonly TransformFieldV3[] = [
  'x', 'y', 'scaleXPercent', 'scaleYPercent', 'rotationDegrees',
]

export function ImageEditorLayerTransformPropertiesV3({
  controller,
  layer,
  disabled,
}: {
  controller: ImageEditorV3Controller
  layer: ImageEditLayerV3
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation('ui')
  const previewId = `${controller.sessionId}:${layer.id}:transform-properties`
  const [draft, setDraft] = useState(() => decomposeImageEditTransformV3(layer.transform))
  const [invalid, setInvalid] = useState(false)
  const activeRef = useRef(false)
  const layerIdRef = useRef(layer.id)
  const draftRef = useRef(draft)

  useEffect(() => {
    if (activeRef.current && layerIdRef.current === layer.id) return
    activeRef.current = false
    layerIdRef.current = layer.id
    const next = decomposeImageEditTransformV3(layer.transform)
    draftRef.current = next
    setDraft(next)
    setInvalid(false)
  }, [layer.id, layer.transform])

  useEffect(() => () => controller.clearTransformPreview(previewId), [controller, previewId])

  useEffect(() => {
    if (!disabled || !activeRef.current) return
    activeRef.current = false
    controller.clearTransformPreview(previewId)
    const next = decomposeImageEditTransformV3(layer.transform)
    draftRef.current = next
    setDraft(next)
    setInvalid(false)
  }, [controller, disabled, layer.transform, previewId])

  const cancel = (): void => {
    activeRef.current = false
    controller.clearTransformPreview(previewId)
    const next = decomposeImageEditTransformV3(layer.transform)
    draftRef.current = next
    setDraft(next)
    setInvalid(false)
  }

  const update = (field: TransformFieldV3, value: number): void => {
    if (disabled || !Number.isFinite(value)) return
    const next = { ...draftRef.current, [field]: value }
    activeRef.current = true
    draftRef.current = next
    setDraft(next)
    const transform = composeImageEditTransformV3(next)
    setInvalid(!transform)
    if (transform) controller.setTransformPreview(previewId, layer.id, transform)
    else controller.clearTransformPreview(previewId)
  }

  const commit = (): void => {
    if (!activeRef.current) return
    const transform = composeImageEditTransformV3(draftRef.current)
    if (disabled || !transform) {
      cancel()
      return
    }
    activeRef.current = false
    setInvalid(false)
    controller.commitTransformPreview(previewId, layer.id, transform)
  }

  const labels: Record<TransformFieldV3, string> = {
    x: t('imageEditor.v3.properties.transformX'),
    y: t('imageEditor.v3.properties.transformY'),
    scaleXPercent: t('imageEditor.v3.properties.scaleX'),
    scaleYPercent: t('imageEditor.v3.properties.scaleY'),
    rotationDegrees: t('imageEditor.v3.properties.rotation'),
  }

  return (
    <UiGroup divided className="mt-5" title={t('imageEditor.v3.properties.transform')} gap="stack">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {FIELD_KEYS.map((field) => (
          <UiFormRow key={field} label={labels[field]}>
            <UiInput
              type="number"
              step={field === 'rotationDegrees' ? 0.1 : 1}
              aria-label={labels[field]}
              aria-invalid={invalid || undefined}
              value={Number(draft[field].toFixed(4))}
              disabled={disabled}
              onChange={(event) => update(field, Number(event.currentTarget.value))}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancel()
                  event.currentTarget.blur()
                }
              }}
            />
          </UiFormRow>
        ))}
      </div>
      {invalid ? (
        <p role="status" className="text-xs text-warning">
          {t('imageEditor.v3.properties.transformSingular')}
        </p>
      ) : null}
    </UiGroup>
  )
}
