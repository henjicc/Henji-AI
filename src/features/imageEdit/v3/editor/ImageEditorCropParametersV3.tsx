import { ChevronDown, Crop, FlipHorizontal, RotateCcw, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UiButton, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import type { ImageEditCropRectV3, ImageEditOrientationV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { projectImageEditorPreviewDocumentV3 } from '../execution/previewDocumentV3'
import {
  useImageEditorSessionStoreV3,
  type ImageEditorCropAspectRatioV3,
} from '../store/imageEditorSessionStoreV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorBusSnapshotV3 } from './useImageEditorControllerV3'

interface CropDraftV3 {
  x: string
  y: string
  width: string
  height: string
}

const CROP_ASPECT_RATIOS_V3: readonly ImageEditorCropAspectRatioV3[] = [
  'free', 'original', '1:1', '4:3', '3:4', '16:9', '9:16', '2:1', '21:9',
]

function cropRatioPreviewSize(
  ratio: ImageEditorCropAspectRatioV3,
  size: { width: number; height: number },
): { width: number; height: number } | null {
  if (ratio === 'free') return null
  const [width, height] = ratio === 'original'
    ? [size.width, size.height]
    : ratio.split(':').map(Number)
  if (!width || !height) return null
  const scale = Math.min(28 / width, 22 / height)
  return {
    width: Math.max(4, Math.round(width * scale)),
    height: Math.max(4, Math.round(height * scale)),
  }
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
  bus,
}: {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
}): JSX.Element {
  const { t } = useTranslation('ui')
  const previewId = `${controller.sessionId}:output-geometry`
  const snapshot = useImageEditorBusSnapshotV3(bus)
  const projectedDocument = useMemo(
    () => projectImageEditorPreviewDocumentV3(snapshot),
    [snapshot],
  )
  const projectedOrientation = projectedDocument.geometry.orientation
  const [orientation, setOrientation] = useState<ImageEditOrientationV3>(projectedOrientation)
  const initialSize = orientedSize(controller, projectedOrientation)
  const [cropEnabled, setCropEnabled] = useState(projectedDocument.geometry.crop !== null)
  const [draft, setDraft] = useState<CropDraftV3>(() => (
    draftFromCrop(projectedDocument.geometry.crop, initialSize)
  ))
  const cropAspectRatio = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.toolSettings.cropAspectRatio ?? 'free',
  )
  const setToolSetting = useImageEditorSessionStoreV3((state) => state.setToolSetting)
  const size = useMemo(
    () => orientedSize(controller, orientation),
    [controller, orientation],
  )
  const parsedCrop = cropEnabled ? parseDraft(draft, size) : null
  const valid = !cropEnabled || parsedCrop !== null
  const documentOrientation = controller.document.geometry.orientation
  const committedCrop = controller.document.geometry.crop
  const dirty = orientation.rotate !== documentOrientation.rotate
    || orientation.mirrored !== documentOrientation.mirrored
    || !sameCrop(cropEnabled ? parsedCrop : null, committedCrop)
  const cropAspectRatioLabel = t(
    `imageEditor.v3.crop.ratios.${cropAspectRatio.replace(':', '-')}`,
  )

  useEffect(() => {
    const nextOrientation = projectedDocument.geometry.orientation
    const nextSize = orientedSize(controller, nextOrientation)
    setOrientation(nextOrientation)
    setCropEnabled(projectedDocument.geometry.crop !== null)
    setDraft(draftFromCrop(projectedDocument.geometry.crop, nextSize))
  }, [controller, projectedDocument.geometry.crop, projectedDocument.geometry.orientation])

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
    <div data-crop-parameters className="flex h-full min-w-max items-center gap-1.5">
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
      <div className="mx-0.5 h-5 w-px shrink-0 bg-border-dark" aria-hidden="true" />
      <PanelTrigger
        className="shrink-0"
        panelWidth={278}
        closeOnPanelClick
        renderPanel={() => (
          <div
            data-crop-ratio-menu
            role="menu"
            aria-label={t('imageEditor.v3.crop.aspectRatio')}
            className="grid grid-cols-3 gap-1 p-2"
          >
            {CROP_ASPECT_RATIOS_V3.map((ratio) => {
              const previewSize = cropRatioPreviewSize(ratio, size)
              const label = t(`imageEditor.v3.crop.ratios.${ratio.replace(':', '-')}`)
              return (
                <UiOptionButton
                  key={ratio}
                  type="button"
                  role="menuitemradio"
                  aria-checked={cropAspectRatio === ratio}
                  active={cropAspectRatio === ratio}
                  variant="menu"
                  className="h-14 min-w-0 flex-col justify-center gap-1 text-xs"
                  onClick={() => setToolSetting(controller.sessionId, 'cropAspectRatio', ratio)}
                >
                  <span className="flex h-6 items-center justify-center" aria-hidden="true">
                    {ratio === 'free' ? (
                      <Crop className="h-4 w-4" />
                    ) : (
                      <span
                        className="block border-2 border-current"
                        style={previewSize ?? undefined}
                      />
                    )}
                  </span>
                  <span className="truncate font-medium leading-none">{label}</span>
                </UiOptionButton>
              )
            })}
          </div>
        )}
      >
        {({ open, togglePanel }) => (
          <UiButton
            type="button"
            data-panel-trigger-button
            size="sm"
            variant="muted"
            className="h-8 w-24 justify-between !px-2"
            aria-label={`${t('imageEditor.v3.crop.aspectRatio')}: ${cropAspectRatioLabel}`}
            title={`${t('imageEditor.v3.crop.aspectRatio')}: ${cropAspectRatioLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={togglePanel}
          >
            <span className="truncate">{cropAspectRatioLabel}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </UiButton>
        )}
      </PanelTrigger>
      {(['x', 'y', 'width', 'height'] as const).map((key) => (
        <label key={key} className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
          <span>{t(`imageEditor.v3.crop.${key}`)}</span>
          <UiInput
            className="!h-8 !w-16 !px-2 tabular-nums"
            type="number"
            min={0}
            step={1}
            aria-invalid={!valid}
            value={draft[key]}
            onChange={(event) => updateDraft(key, event.currentTarget.value)}
          />
        </label>
      ))}
      <div className="flex shrink-0 items-center gap-1.5">
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
