import {
  ArrowRight,
  Brush,
  Circle,
  Grid3x3,
  ListOrdered,
  MessageSquareText,
  Square,
  Type,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { UiChipButton, UiColorInput, UiIconButton, UiRangeInput, UiSwitch } from '@/components/ui'
import {
  MAX_MOSAIC_STRENGTH_PERCENT,
  MIN_MOSAIC_STRENGTH_PERCENT,
} from '@/core/imageEdit/constraints'
import type { MarkItem } from '@/core/imageEdit/types'
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'
import {
  annotationHasFontSizeV3,
  annotationHasStrokeV3,
  annotationHasTextBackgroundV3,
  isAnnotationCalloutV3,
  patchAnnotationStyleV3,
  readAnnotationStyleV3,
  type AnnotationStylePatchV3,
} from './annotationStyleV3'
import {
  IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3,
  isImageEditorAnnotationToolV3,
  type ImageEditorAnnotationToolIdV3,
} from './annotationToolsV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorAnnotationPreviewV3 } from './useImageEditorAnnotationPreviewV3'

const ANNOTATION_TOOL_ICONS: Record<ImageEditorAnnotationToolIdV3, typeof Type> = {
  'annotation-text': Type,
  'annotation-callout': MessageSquareText,
  'annotation-arrow': ArrowRight,
  'annotation-rect': Square,
  'annotation-ellipse': Circle,
  'annotation-number': ListOrdered,
  'annotation-pen': Brush,
  'annotation-mosaic': Grid3x3,
}

function annotationMatchesTool(
  annotation: MarkItem,
  tool: ImageEditorAnnotationToolIdV3,
): boolean {
  if (tool === 'annotation-callout') return isAnnotationCalloutV3(annotation)
  if (tool === 'annotation-rect') return annotation.type === 'rect' && !isAnnotationCalloutV3(annotation)
  if (tool === 'annotation-ellipse') {
    return annotation.type === 'ellipse' && !isAnnotationCalloutV3(annotation)
  }
  return annotation.type === tool.slice('annotation-'.length)
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="mr-1 text-xs text-text-muted">{label}</span>
      {IMAGE_EDITOR_PRESET_COLORS.map((color) => {
        const active = value.toLowerCase() === color.toLowerCase()
        return (
          <UiIconButton
            key={color}
            className={`h-6 w-6 rounded-full !p-1 ${active ? 'ring-2 ring-veil-strong' : ''}`}
            showBorder={false}
            appearance="hover-only"
            aria-label={`${label} ${color}`}
            aria-pressed={active}
            title={`${label} ${color}`}
            onClick={() => onChange(color)}
          >
            <span
              className="block h-full w-full rounded-full border border-veil-soft"
              style={{ backgroundColor: color }}
            />
          </UiIconButton>
        )
      })}
      <UiColorInput
        className="!h-6 !w-6"
        value={value}
        aria-label={label}
        title={label}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  )
}

function ToolPicker({
  controller,
  activeTool,
  onSelect,
}: {
  controller: ImageEditorV3Controller
  activeTool: ImageEditorToolIdV3
  onSelect: (tool: ImageEditorAnnotationToolIdV3) => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  return (
    <div
      role="group"
      aria-label={t('imageEditor.v3.toolSettings.annotationType')}
      className="flex shrink-0 items-center gap-0.5"
    >
      {IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3.flatMap((toolId) => {
        const ready = controller.profile.tools.some(({ id, readiness }) => (
          id === toolId && readiness.state === 'ready'
        ))
        if (!ready) return []
        const Icon = ANNOTATION_TOOL_ICONS[toolId]
        const label = t(`imageEditor.v3.tools.${toolId}`)
        return [(
          <UiIconButton
            key={toolId}
            data-annotation-tool-id={toolId}
            className="h-8 w-8"
            showBorder={false}
            appearance="hover-only"
            active={activeTool === toolId}
            aria-label={label}
            aria-pressed={activeTool === toolId}
            title={label}
            onClick={() => onSelect(toolId)}
          >
            <Icon className="h-4 w-4" />
          </UiIconButton>
        )]
      })}
    </div>
  )
}

export function ImageEditorAnnotationParametersV3({
  controller,
}: {
  controller: ImageEditorV3Controller
}): JSX.Element | null {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3((state) => state.sessions[controller.sessionId])
  const setToolSetting = useImageEditorSessionStoreV3((state) => state.setToolSetting)
  const setActiveTool = useImageEditorSessionStoreV3((state) => state.setActiveTool)
  const selection = useImageEditorInteractionStoreV3(
    (state) => state.annotationSelectionBySession[controller.sessionId] ?? null,
  )
  const layer = selection
    ? findImageEditLayerLocationV3(controller.document.layers, selection.layerId)?.layer
    : null
  const committed = layer?.type === 'annotation'
    ? layer.annotations.find(({ id }) => id === selection?.annotationId) ?? null
    : null
  const preview = useImageEditorAnnotationPreviewV3(
    controller,
    selection?.layerId ?? null,
    committed,
  )
  const selected = preview.annotation
  const activeAnnotationTool = session && isImageEditorAnnotationToolV3(session.activeTool)
    ? session.activeTool
    : null
  const editingSelected = selected && (
    activeAnnotationTool === null || annotationMatchesTool(selected, activeAnnotationTool)
  ) ? selected : null
  const selectedStyle = editingSelected ? readAnnotationStyleV3(editingSelected) : null

  useEffect(() => {
    if (!session || !activeAnnotationTool
      || session.toolSettings.annotationTool === activeAnnotationTool) return
    setToolSetting(controller.sessionId, 'annotationTool', activeAnnotationTool)
  }, [activeAnnotationTool, controller.sessionId, session, setToolSetting])

  useEffect(() => {
    if (!session || !selectedStyle) return
    if (selectedStyle.color !== null && selectedStyle.color !== session.toolSettings.annotationColor) {
      setToolSetting(controller.sessionId, 'annotationColor', selectedStyle.color)
    }
    if (selectedStyle.lineWidth !== null
      && selectedStyle.lineWidth !== session.toolSettings.annotationStrokeWidth) {
      setToolSetting(controller.sessionId, 'annotationStrokeWidth', selectedStyle.lineWidth)
    }
    if (selectedStyle.fontSize !== null
      && selectedStyle.fontSize !== session.toolSettings.annotationFontSize) {
      setToolSetting(controller.sessionId, 'annotationFontSize', selectedStyle.fontSize)
    }
    if (selectedStyle.calloutShape !== null
      && selectedStyle.calloutShape !== session.toolSettings.annotationCalloutShape) {
      setToolSetting(controller.sessionId, 'annotationCalloutShape', selectedStyle.calloutShape)
    }
    if (selectedStyle.textBackgroundEnabled !== null
      && selectedStyle.textBackgroundEnabled !== session.toolSettings.annotationTextBackgroundEnabled) {
      setToolSetting(controller.sessionId, 'annotationTextBackgroundEnabled', selectedStyle.textBackgroundEnabled)
    }
    if (selectedStyle.textBackgroundColor !== null
      && selectedStyle.textBackgroundColor !== session.toolSettings.annotationTextBackgroundColor) {
      setToolSetting(controller.sessionId, 'annotationTextBackgroundColor', selectedStyle.textBackgroundColor)
    }
    if (selectedStyle.mosaicMode !== null
      && selectedStyle.mosaicMode !== session.toolSettings.annotationMosaicMode) {
      setToolSetting(controller.sessionId, 'annotationMosaicMode', selectedStyle.mosaicMode)
    }
    if (selectedStyle.mosaicStrength !== null
      && selectedStyle.mosaicStrength !== session.toolSettings.annotationMosaicStrength) {
      setToolSetting(controller.sessionId, 'annotationMosaicStrength', selectedStyle.mosaicStrength)
    }
  }, [controller.sessionId, selectedStyle, session, setToolSetting])

  if (!session || (!activeAnnotationTool && !editingSelected)) return null

  const settings = session.toolSettings
  const color = selectedStyle?.color ?? settings.annotationColor
  const strokeWidth = selectedStyle?.lineWidth ?? settings.annotationStrokeWidth
  const fontSize = selectedStyle?.fontSize ?? settings.annotationFontSize
  const calloutShape = selectedStyle?.calloutShape ?? settings.annotationCalloutShape
  const backgroundEnabled = selectedStyle?.textBackgroundEnabled
    ?? settings.annotationTextBackgroundEnabled
  const backgroundColor = selectedStyle?.textBackgroundColor
    ?? settings.annotationTextBackgroundColor
  const mosaicMode = selectedStyle?.mosaicMode ?? settings.annotationMosaicMode
  const mosaicStrength = selectedStyle?.mosaicStrength ?? settings.annotationMosaicStrength
  const showMosaic = editingSelected?.type === 'mosaic' || session.activeTool === 'annotation-mosaic'
  const showColor = editingSelected ? editingSelected.type !== 'mosaic' : !showMosaic
  const showStroke = editingSelected
    ? annotationHasStrokeV3(editingSelected)
    : !['annotation-text', 'annotation-number', 'annotation-mosaic'].includes(session.activeTool)
  const showFontSize = editingSelected
    ? annotationHasFontSizeV3(editingSelected)
    : ['annotation-text', 'annotation-number', 'annotation-callout'].includes(session.activeTool)
  const showCalloutShape = editingSelected
    ? isAnnotationCalloutV3(editingSelected)
    : session.activeTool === 'annotation-callout'
  const showBackground = editingSelected
    ? annotationHasTextBackgroundV3(editingSelected)
    : ['annotation-text', 'annotation-callout'].includes(session.activeTool)

  const apply = (patch: AnnotationStylePatchV3): void => {
    if (patch.color !== undefined) setToolSetting(controller.sessionId, 'annotationColor', patch.color)
    if (patch.lineWidth !== undefined) {
      setToolSetting(controller.sessionId, 'annotationStrokeWidth', patch.lineWidth)
    }
    if (patch.fontSize !== undefined) setToolSetting(controller.sessionId, 'annotationFontSize', patch.fontSize)
    if (patch.calloutShape !== undefined) {
      setToolSetting(controller.sessionId, 'annotationCalloutShape', patch.calloutShape)
    }
    if (patch.textBackgroundEnabled !== undefined) {
      setToolSetting(controller.sessionId, 'annotationTextBackgroundEnabled', patch.textBackgroundEnabled)
    }
    if (patch.textBackgroundColor !== undefined) {
      setToolSetting(controller.sessionId, 'annotationTextBackgroundColor', patch.textBackgroundColor)
    }
    if (patch.mosaicMode !== undefined) {
      setToolSetting(controller.sessionId, 'annotationMosaicMode', patch.mosaicMode)
    }
    if (patch.mosaicStrength !== undefined) {
      setToolSetting(controller.sessionId, 'annotationMosaicStrength', patch.mosaicStrength)
    }
    if (editingSelected && selection) {
      preview.update(patchAnnotationStyleV3(editingSelected, patch))
    }
  }
  const applyAndCommit = (patch: AnnotationStylePatchV3): void => {
    apply(patch)
    queueMicrotask(preview.commit)
  }

  return (
    <>
      {activeAnnotationTool ? (
        <ToolPicker
          controller={controller}
          activeTool={activeAnnotationTool}
          onSelect={(toolId) => {
            setToolSetting(controller.sessionId, 'annotationTool', toolId)
            setActiveTool(controller.sessionId, toolId)
          }}
        />
      ) : null}
      {showMosaic ? (
        <>
          <div role="group" aria-label={t('imageEditor.v3.toolSettings.mosaicMode')} className="flex gap-1">
            {(['pixel', 'blur'] as const).map((mode) => (
              <UiChipButton
                key={mode}
                className="!h-8 !px-2 !text-xs"
                selectionRole="navigation"
                active={mosaicMode === mode}
                onClick={() => applyAndCommit({ mosaicMode: mode })}
              >
                {t(`imageEditor.v3.toolSettings.mosaic${mode === 'pixel' ? 'Pixel' : 'Blur'}`)}
              </UiChipButton>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
            <span>{t('imageEditor.v3.toolSettings.strength')}</span>
            <UiRangeInput
              className="!w-24"
              aria-label={t('imageEditor.v3.toolSettings.strength')}
              min={MIN_MOSAIC_STRENGTH_PERCENT}
              max={MAX_MOSAIC_STRENGTH_PERCENT}
              step={0.5}
              value={mosaicStrength}
              onChange={(event) => apply({ mosaicStrength: Number(event.currentTarget.value) })}
              onPointerUp={preview.commit}
              onPointerCancel={preview.cancel}
              onBlur={preview.commit}
            />
            <span className="w-9 text-right tabular-nums text-text-dark">
              {mosaicStrength.toFixed(1)}%
            </span>
          </label>
        </>
      ) : null}
      {showCalloutShape ? (
        <div role="group" aria-label={t('imageEditor.v3.toolSettings.calloutShape')} className="flex gap-0.5">
          {(['rect', 'ellipse'] as const).map((shape) => {
            const Icon = shape === 'rect' ? Square : Circle
            const label = t(`imageEditor.v3.toolSettings.${shape}`)
            return (
              <UiIconButton
                key={shape}
                className="h-8 w-8"
                showBorder={false}
                appearance="hover-only"
                active={calloutShape === shape}
                aria-label={label}
                aria-pressed={calloutShape === shape}
                title={label}
                onClick={() => applyAndCommit({ calloutShape: shape })}
              >
                <Icon className="h-4 w-4" />
              </UiIconButton>
            )
          })}
        </div>
      ) : null}
      {showColor ? (
        <ColorPicker label={t('imageEditor.v3.toolSettings.color')} value={color} onChange={(next) => (
          applyAndCommit({ color: next })
        )} />
      ) : null}
      {showBackground ? (
        <>
          <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
            <span>{t('imageEditor.v3.toolSettings.textBackground')}</span>
            <UiSwitch
              aria-label={t('imageEditor.v3.toolSettings.textBackground')}
              checked={backgroundEnabled}
              onCheckedChange={(enabled) => applyAndCommit({
                textBackgroundEnabled: enabled,
                textBackgroundColor: backgroundColor,
              })}
            />
          </label>
          {backgroundEnabled ? (
            <ColorPicker
              label={t('imageEditor.v3.toolSettings.backgroundColor')}
              value={backgroundColor}
              onChange={(next) => applyAndCommit({ textBackgroundColor: next })}
            />
          ) : null}
        </>
      ) : null}
      {showStroke ? (
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <span>{t('imageEditor.v3.toolSettings.strokeWidth')}</span>
          <UiRangeInput
            className="!w-24"
            aria-label={t('imageEditor.v3.toolSettings.strokeWidth')}
            min={1}
            max={64}
            value={strokeWidth}
            onChange={(event) => apply({ lineWidth: Number(event.currentTarget.value) })}
            onPointerUp={preview.commit}
            onPointerCancel={preview.cancel}
            onBlur={preview.commit}
          />
          <span className="w-8 text-right tabular-nums text-text-dark">{Math.round(strokeWidth)}</span>
        </label>
      ) : null}
      {showFontSize ? (
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <span>{t('imageEditor.v3.toolSettings.fontSize')}</span>
          <UiRangeInput
            className="!w-24"
            aria-label={t('imageEditor.v3.toolSettings.fontSize')}
            min={8}
            max={256}
            value={fontSize}
            onChange={(event) => apply({ fontSize: Number(event.currentTarget.value) })}
            onPointerUp={preview.commit}
            onPointerCancel={preview.cancel}
            onBlur={preview.commit}
          />
          <span className="w-8 text-right tabular-nums text-text-dark">{Math.round(fontSize)}</span>
        </label>
      ) : null}
    </>
  )
}
