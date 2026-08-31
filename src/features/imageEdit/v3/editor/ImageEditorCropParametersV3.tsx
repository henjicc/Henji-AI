import { FlipHorizontal, RotateCcw, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import type { ImageEditCropRectV3, ImageEditOrientationV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditorV3Controller } from './types'

interface CropDraftV3 {
  x: string
  y: string
  width: string
  height: string
}

function orientedSize(
  controller: ImageEditorV3Controller,
  orientation: ImageEditOrientationV3,
): { width: number; height: number } {
  const rotated = orientation.rotate === 90 || orientation.rotate === 270
  return rotated
    ? { width: controller.document.geometry.height, height: controller.document.geometry.width }
    : { width: controller.document.geometry.width, height: controller.document.geometry.height }
}

function draftFromCrop(crop: ImageEditCropRectV3 | null, size: { width: number; height: number }): CropDraftV3 {
  const value = crop ?? { x: 0, y: 0, width: size.width, height: size.height }
  return {
    x: String(value.x),
    y: String(value.y),
    width: String(value.width),
    height: String(value.height),
  }
}

function parseDraft(draft: CropDraftV3, size: { width: number; height: number }): ImageEditCropRectV3 | null {
  const crop = {
    x: Number(draft.x),
    y: Number(draft.y),
    width: Number(draft.width),
    height: Number(draft.height),
  }
  if (!Object.values(crop).every(Number.isSafeInteger)
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > size.width || crop.y + crop.height > size.height) return null
  return crop
}

function sameCrop(left: ImageEditCropRectV3 | null, right: ImageEditCropRectV3 | null): boolean {
  return left === null && right === null
    || left !== null && right !== null
      && left.x === right.x && left.y === right.y
      && left.width === right.width && left.height === right.height
}

export function ImageEditorCropParametersV3({
  controller,
}: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const previewId = `${controller.sessionId}:output-geometry`
  const documentOrientation = controller.document.geometry.orientation
  const [orientation, setOrientation] = useState<ImageEditOrientationV3>(documentOrientation)
  const initialSize = orientedSize(controller, documentOrientation)
  const [cropEnabled, setCropEnabled] = useState(controller.document.geometry.crop !== null)
  const [draft, setDraft] = useState<CropDraftV3>(() => (
    draftFromCrop(controller.document.geometry.crop, initialSize)
  ))
  const size = useMemo(
    () => orientedSize(controller, orientation),
    [controller, orientation],
  )
  const parsedCrop = cropEnabled ? parseDraft(draft, size) : null
  const valid = !cropEnabled || parsedCrop !== null
  const committedCrop = controller.document.geometry.crop
  const dirty = orientation.rotate !== documentOrientation.rotate
    || orientation.mirrored !== documentOrientation.mirrored
    || !sameCrop(cropEnabled ? parsedCrop : null, committedCrop)

  useEffect(() => {
    const nextOrientation = controller.document.geometry.orientation
    const nextSize = orientedSize(controller, nextOrientation)
    setOrientation(nextOrientation)
    setCropEnabled(controller.document.geometry.crop !== null)
    setDraft(draftFromCrop(controller.document.geometry.crop, nextSize))
  }, [controller])

  useEffect(() => () => controller.clearOutputGeometryPreview(previewId), [controller, previewId])

  const preview = (
    nextOrientation: ImageEditOrientationV3,
    nextCrop: ImageEditCropRectV3 | null,
  ): void => {
    controller.setOutputGeometryPreview(previewId, nextOrientation, nextCrop)
  }

  const updateDraft = (key: keyof CropDraftV3, value: string): void => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    setCropEnabled(true)
    const crop = parseDraft(next, size)
    if (crop) preview(orientation, crop)
  }

  const rotate = (step: -90 | 90): void => {
    const next: ImageEditOrientationV3 = {
      ...orientation,
      rotate: ((orientation.rotate + step + 360) % 360) as ImageEditOrientationV3['rotate'],
    }
    const nextSize = orientedSize(controller, next)
    setOrientation(next)
    setCropEnabled(false)
    setDraft(draftFromCrop(null, nextSize))
    preview(next, null)
  }

  const reset = (): void => {
    const nextOrientation = controller.document.geometry.orientation
    const nextSize = orientedSize(controller, nextOrientation)
    setOrientation(nextOrientation)
    setCropEnabled(controller.document.geometry.crop !== null)
    setDraft(draftFromCrop(controller.document.geometry.crop, nextSize))
    controller.clearOutputGeometryPreview(previewId)
  }

  const clearCrop = (): void => {
    setCropEnabled(false)
    setDraft(draftFromCrop(null, size))
    preview(orientation, null)
  }

  const apply = (): void => {
    if (!valid || !dirty) return
    const crop = cropEnabled ? parsedCrop : null
    controller.setOutputGeometryPreview(previewId, orientation, crop)
    controller.commitOutputGeometryPreview(previewId, orientation, crop)
  }

  return (
    <div data-crop-parameters className="flex min-h-10 items-center gap-2 overflow-x-auto px-3 py-1.5">
      <UiIconButton
        className="h-8 w-8 shrink-0"
        showBorder={false}
        appearance="hover-only"
        aria-label={t('imageEditor.v3.crop.rotateLeft')}
        title={t('imageEditor.v3.crop.rotateLeft')}
        onClick={() => rotate(-90)}
      >
        <RotateCcw className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton
        className="h-8 w-8 shrink-0"
        showBorder={false}
        appearance="hover-only"
        aria-label={t('imageEditor.v3.crop.rotateRight')}
        title={t('imageEditor.v3.crop.rotateRight')}
        onClick={() => rotate(90)}
      >
        <RotateCw className="h-4 w-4" />
      </UiIconButton>
      <UiIconButton
        className="h-8 w-8 shrink-0"
        showBorder={false}
        appearance="hover-only"
        active={orientation.mirrored}
        aria-label={t('imageEditor.v3.crop.mirror')}
        aria-pressed={orientation.mirrored}
        title={t('imageEditor.v3.crop.mirror')}
        onClick={() => {
          const next = { ...orientation, mirrored: !orientation.mirrored }
          setOrientation(next)
          setCropEnabled(false)
          setDraft(draftFromCrop(null, size))
          preview(next, null)
        }}
      >
        <FlipHorizontal className="h-4 w-4" />
      </UiIconButton>
      <div className="mx-1 h-5 w-px shrink-0 bg-border-dark" aria-hidden="true" />
      {(['x', 'y', 'width', 'height'] as const).map((key) => (
        <label key={key} className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
          <span>{t(`imageEditor.v3.crop.${key}`)}</span>
          <UiInput
            className="!h-8 w-20 !px-2 tabular-nums"
            type="number"
            min={0}
            step={1}
            aria-invalid={!valid}
            value={draft[key]}
            onChange={(event) => updateDraft(key, event.currentTarget.value)}
          />
        </label>
      ))}
      <span className="shrink-0 text-xs tabular-nums text-text-muted">
        {size.width} × {size.height}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <UiButton size="sm" variant="plain" onClick={clearCrop}>
          {t('imageEditor.v3.crop.fullImage')}
        </UiButton>
        <UiButton size="sm" variant="ghost" onClick={reset}>
          {t('imageEditor.v3.crop.cancel')}
        </UiButton>
        <UiButton size="sm" variant="primary" disabled={!valid || !dirty} onClick={apply}>
          {t('imageEditor.v3.crop.apply')}
        </UiButton>
      </div>
    </div>
  )
}
