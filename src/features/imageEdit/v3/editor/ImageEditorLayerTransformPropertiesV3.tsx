import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { UiFieldLayoutContext, UiFormRow, UiGroup } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3'

import {
  composeImageEditTransformV3,
  decomposeImageEditTransformV3,
  type ImageEditTransformFieldsV3,
} from './layerTransformV3'
import type { ImageEditorV3Controller } from './types'

type TransformFieldV3 = Exclude<keyof ImageEditTransformFieldsV3, 'shear'>

const TRANSFORM_PRECISION = 2


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
  const scrubbingRef = useRef(false)

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

  // 组不成变换（缩放为零）：读数回到原值，提示留着说明为什么没生效
  const commitOrReject = (): void => {
    if (composeImageEditTransformV3(draftRef.current)) commit()
    else { cancel(); setInvalid(true) }
  }

  // 拖动读数时逐帧预览、松手才提交（一次拖动一步撤销）；键入的值回车或失焦即提交。
  // 读数保留两位小数；失焦时值没变（只是点进去又离开）不提交，不把自由变换的值取整、也不多记一步撤销
  const field = (key: TransformFieldV3, unit: string): ReactNode => (
    <>
      <NumberInput
        ariaLabel={labels[key]}
        size="sm"
        value={Number(draft[key].toFixed(TRANSFORM_PRECISION))}
        step={key === 'rotationDegrees' ? 0.1 : 1}
        precision={TRANSFORM_PRECISION}
        disabled={disabled}
        onChange={(value) => {
          if (!scrubbingRef.current && value === Number(draftRef.current[key].toFixed(TRANSFORM_PRECISION))) {
            setInvalid(false)
            return
          }
          update(key, value)
          if (!scrubbingRef.current) commitOrReject()
        }}
        onScrubStart={() => { scrubbingRef.current = true }}
        onScrubEnd={(cancelled) => {
          scrubbingRef.current = false
          if (cancelled) cancel()
          else commitOrReject()
        }}
      />
      <span className="text-xs text-text3">{unit}</span>
    </>
  )

  return (
    <UiGroup titleTone="compact" divided title={t('imageEditor.v3.properties.transform')} gap="stack">
      {/* 与剪辑效果控件同一种属性行：名称一列，数值紧跟名称、不画框，单位跟在数字后面 */}
      <UiFieldLayoutContext.Provider value="property">
        <div className="flex flex-col">
          <UiFormRow label={t('imageEditor.v3.properties.position')}>{field('x', 'X')}{field('y', 'Y')}</UiFormRow>
          <UiFormRow label={t('imageEditor.v3.properties.scale')}>{field('scaleXPercent', '%')}{field('scaleYPercent', '%')}</UiFormRow>
          <UiFormRow label={t('imageEditor.v3.properties.rotationName')}>{field('rotationDegrees', '°')}</UiFormRow>
        </div>
      </UiFieldLayoutContext.Provider>
      {invalid ? (
        <p role="status" className="text-xs text-warning-text">
          {t('imageEditor.v3.properties.transformSingular')}
        </p>
      ) : null}
    </UiGroup>
  )
}
