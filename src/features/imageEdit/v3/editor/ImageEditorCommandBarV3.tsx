import { Redo2, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { UiChipButton, UiIconButton, UiInput, UiRangeInput, UiSelect } from '@/components/ui'
import { ICON_TOOL_IMAGE_EDIT } from '@/core/theme/icons'
import { ImageEditorCropParametersV3 } from './ImageEditorCropParametersV3'
import {
  IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3,
  isImageEditorAnnotationToolV3,
} from './annotationToolsV3'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import {
  annotationHasFontSizeV3,
  annotationHasStrokeV3,
  isAnnotationCalloutV3,
  patchAnnotationStyleV3,
  readAnnotationStyleV3,
  type AnnotationStylePatchV3,
} from './annotationStyleV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'
import { imageEditorSelectionAllowedCombineModesV3 } from './selectionMaskLayerV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorAnnotationPreviewV3 } from './useImageEditorAnnotationPreviewV3'
import { useImageEditorInteractionStoreV3, useImageEditorSessionStoreV3 } from '../store'

interface ImageEditorCommandBarV3Props {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
  toolbarLeading?: React.ReactNode
  toolbarActions?: React.ReactNode
}

const EMPTY_LAYER_IDS: readonly string[] = []

function ToolParameterBar({
  controller,
  bus,
}: Pick<ImageEditorCommandBarV3Props, 'controller' | 'bus'>): JSX.Element | null {
  const { t } = useTranslation('ui')
  const session = useImageEditorSessionStoreV3((state) => state.sessions[controller.sessionId])
  const setToolSetting = useImageEditorSessionStoreV3((state) => state.setToolSetting)
  const setActiveTool = useImageEditorSessionStoreV3((state) => state.setActiveTool)
  const selectedLayerIds = useImageEditorSessionStoreV3(
    (state) => state.sessions[controller.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS,
  )
  const selectedLayer = selectedLayerIds.length === 1
    ? findImageEditLayerLocationV3(controller.document.layers, selectedLayerIds[0])?.layer ?? null
    : null
  const annotationSelection = useImageEditorInteractionStoreV3(
    (state) => state.annotationSelectionBySession[controller.sessionId] ?? null,
  )
  const annotationLayer = annotationSelection
    ? findImageEditLayerLocationV3(controller.document.layers, annotationSelection.layerId)?.layer
    : null
  const committedAnnotation = annotationLayer?.type === 'annotation'
    ? annotationLayer.annotations.find(({ id }) => id === annotationSelection?.annotationId) ?? null
    : null
  const annotationPreview = useImageEditorAnnotationPreviewV3(
    controller,
    annotationSelection?.layerId ?? null,
    committedAnnotation,
  )
  const selectedAnnotation = annotationPreview.annotation
  const selectedAnnotationStyle = selectedAnnotation
    ? readAnnotationStyleV3(selectedAnnotation)
    : null
  const allowedSelectionModes = imageEditorSelectionAllowedCombineModesV3(selectedLayer)
  const selectionLike = session?.activeTool.startsWith('select-') ?? false
  useEffect(() => {
    if (!session || !selectionLike
      || allowedSelectionModes.includes(session.toolSettings.selectionCombineMode)) return
    setToolSetting(controller.sessionId, 'selectionCombineMode', 'replace')
  }, [
    allowedSelectionModes,
    controller.sessionId,
    selectionLike,
    session,
    setToolSetting,
  ])
  useEffect(() => {
    if (!session || !isImageEditorAnnotationToolV3(session.activeTool)
      || session.toolSettings.annotationTool === session.activeTool) return
    setToolSetting(controller.sessionId, 'annotationTool', session.activeTool)
  }, [controller.sessionId, session, setToolSetting])
  useEffect(() => {
    if (!session || !selectedAnnotationStyle) return
    if (selectedAnnotationStyle.color !== null
      && selectedAnnotationStyle.color !== session.toolSettings.annotationColor) {
      setToolSetting(controller.sessionId, 'annotationColor', selectedAnnotationStyle.color)
    }
    if (selectedAnnotationStyle.lineWidth !== null
      && selectedAnnotationStyle.lineWidth !== session.toolSettings.annotationStrokeWidth) {
      setToolSetting(controller.sessionId, 'annotationStrokeWidth', selectedAnnotationStyle.lineWidth)
    }
    if (selectedAnnotationStyle.fontSize !== null
      && selectedAnnotationStyle.fontSize !== session.toolSettings.annotationFontSize) {
      setToolSetting(controller.sessionId, 'annotationFontSize', selectedAnnotationStyle.fontSize)
    }
    if (selectedAnnotationStyle.calloutShape !== null
      && selectedAnnotationStyle.calloutShape !== session.toolSettings.annotationCalloutShape) {
      setToolSetting(controller.sessionId, 'annotationCalloutShape', selectedAnnotationStyle.calloutShape)
    }
  }, [
    controller.sessionId,
    selectedAnnotationStyle,
    session,
    setToolSetting,
  ])
  if (!session) return null

  const brushLike = ['raster-brush', 'eraser', 'mask-edit'].includes(session.activeTool)
  const activeAnnotationTool = session.activeTool.startsWith('annotation-')
  const annotationLike = activeAnnotationTool || (session.activeTool === 'move' && Boolean(selectedAnnotation))
  if (session.activeTool === 'crop') {
    return <ImageEditorCropParametersV3 controller={controller} bus={bus} />
  }
  if (!brushLike && !annotationLike && !selectionLike) return null

  const annotationColor = selectedAnnotationStyle?.color
    ?? session.toolSettings.annotationColor
  const annotationStrokeWidth = selectedAnnotationStyle?.lineWidth
    ?? session.toolSettings.annotationStrokeWidth
  const annotationFontSize = selectedAnnotationStyle?.fontSize
    ?? session.toolSettings.annotationFontSize
  const annotationCalloutShape = selectedAnnotationStyle?.calloutShape
    ?? session.toolSettings.annotationCalloutShape
  const showAnnotationStroke = selectedAnnotation
    ? annotationHasStrokeV3(selectedAnnotation)
    : !['annotation-text', 'annotation-number'].includes(session.activeTool)
  const showAnnotationFontSize = selectedAnnotation
    ? annotationHasFontSizeV3(selectedAnnotation)
    : ['annotation-text', 'annotation-number', 'annotation-callout'].includes(session.activeTool)
  const showAnnotationCalloutShape = selectedAnnotation
    ? isAnnotationCalloutV3(selectedAnnotation)
    : session.activeTool === 'annotation-callout'
  const applyAnnotationStyle = (patch: AnnotationStylePatchV3): void => {
    if (patch.color !== undefined) {
      setToolSetting(controller.sessionId, 'annotationColor', patch.color)
    }
    if (patch.lineWidth !== undefined) {
      setToolSetting(controller.sessionId, 'annotationStrokeWidth', patch.lineWidth)
    }
    if (patch.fontSize !== undefined) {
      setToolSetting(controller.sessionId, 'annotationFontSize', patch.fontSize)
    }
    if (patch.calloutShape !== undefined) {
      setToolSetting(controller.sessionId, 'annotationCalloutShape', patch.calloutShape)
    }
    if (selectedAnnotation && annotationSelection) {
      annotationPreview.update(patchAnnotationStyleV3(selectedAnnotation, patch))
    }
  }

  const commitAnnotationStyle = (): void => annotationPreview.commit()

  return (
    <div
      data-context-bar
      className="flex min-h-10 items-center gap-5 overflow-x-auto px-3 py-1.5"
    >
      {brushLike ? (
        <>
          {session.activeTool === 'mask-edit' ? (
            <div
              role="group"
              aria-label={t('imageEditor.v3.toolSettings.maskMode')}
              className="flex shrink-0 items-center gap-1"
            >
              <UiChipButton
                selectionRole="navigation"
                active={session.toolSettings.maskMode === 'paint'}
                onClick={() => setToolSetting(controller.sessionId, 'maskMode', 'paint')}
              >
                {t('imageEditor.v3.toolSettings.maskPaint')}
              </UiChipButton>
              <UiChipButton
                selectionRole="navigation"
                active={session.toolSettings.maskMode === 'erase'}
                onClick={() => setToolSetting(controller.sessionId, 'maskMode', 'erase')}
              >
                {t('imageEditor.v3.toolSettings.maskErase')}
              </UiChipButton>
            </div>
          ) : null}
          <label className="flex min-w-44 items-center gap-2 text-xs text-text-muted">
            <span className="shrink-0">{t('imageEditor.v3.toolSettings.size')}</span>
            <UiRangeInput
              aria-label={t('imageEditor.v3.toolSettings.size')}
              min={1}
              max={512}
              value={session.toolSettings.brushSize}
              onChange={(event) => setToolSetting(
                controller.sessionId,
                'brushSize',
                Number(event.currentTarget.value),
              )}
            />
            <span className="w-10 text-right tabular-nums text-text-dark">
              {Math.round(session.toolSettings.brushSize)}
            </span>
          </label>
          <label className="flex min-w-40 items-center gap-2 text-xs text-text-muted">
            <span className="shrink-0">{t('imageEditor.v3.toolSettings.opacity')}</span>
            <UiRangeInput
              aria-label={t('imageEditor.v3.toolSettings.opacity')}
              min={0}
              max={1}
              step={0.01}
              value={session.toolSettings.brushOpacity}
              onChange={(event) => setToolSetting(
                controller.sessionId,
                'brushOpacity',
                Number(event.currentTarget.value),
              )}
            />
            <span className="w-9 text-right tabular-nums text-text-dark">
              {Math.round(session.toolSettings.brushOpacity * 100)}%
            </span>
          </label>
          <label className="flex min-w-40 items-center gap-2 text-xs text-text-muted">
            <span className="shrink-0">{t('imageEditor.v3.toolSettings.hardness')}</span>
            <UiRangeInput
              aria-label={t('imageEditor.v3.toolSettings.hardness')}
              min={0}
              max={1}
              step={0.01}
              value={session.toolSettings.brushHardness}
              onChange={(event) => setToolSetting(
                controller.sessionId,
                'brushHardness',
                Number(event.currentTarget.value),
              )}
            />
            <span className="w-9 text-right tabular-nums text-text-dark">
              {Math.round(session.toolSettings.brushHardness * 100)}%
            </span>
          </label>
        </>
      ) : null}
      {annotationLike ? (
        <>
          {activeAnnotationTool ? (
            <div
              role="group"
              aria-label={t('imageEditor.v3.toolSettings.annotationType')}
              className="flex shrink-0 items-center gap-1"
            >
              {IMAGE_EDITOR_ANNOTATION_TOOL_IDS_V3.flatMap((toolId) => (
                controller.profile.tools.some(({ id, readiness }) => (
                  id === toolId && readiness.state === 'ready'
                )) ? [(
                  <UiChipButton
                    key={toolId}
                    selectionRole="navigation"
                    active={session.activeTool === toolId}
                    onClick={() => {
                      setToolSetting(controller.sessionId, 'annotationTool', toolId)
                      setActiveTool(controller.sessionId, toolId)
                    }}
                  >
                    {t(`imageEditor.v3.tools.${toolId}`)}
                  </UiChipButton>
                )] : []
              ))}
            </div>
          ) : null}
          <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
            <span>{t('imageEditor.v3.toolSettings.color')}</span>
            <UiInput
              className="!h-8 !w-10 !p-1"
              type="color"
              aria-label={t('imageEditor.v3.toolSettings.color')}
              value={annotationColor}
              onChange={(event) => {
                applyAnnotationStyle({ color: event.currentTarget.value })
                queueMicrotask(commitAnnotationStyle)
              }}
            />
          </label>
          {showAnnotationStroke ? (
            <label className="flex min-w-40 items-center gap-2 text-xs text-text-muted">
              <span className="shrink-0">{t('imageEditor.v3.toolSettings.strokeWidth')}</span>
              <UiRangeInput
                aria-label={t('imageEditor.v3.toolSettings.strokeWidth')}
                min={1}
                max={64}
                value={annotationStrokeWidth}
                onChange={(event) => applyAnnotationStyle({
                  lineWidth: Number(event.currentTarget.value),
                })}
                onPointerUp={commitAnnotationStyle}
                onPointerCancel={annotationPreview.cancel}
                onBlur={commitAnnotationStyle}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                    commitAnnotationStyle()
                  }
                }}
              />
              <span className="w-8 text-right tabular-nums text-text-dark">
                {Math.round(annotationStrokeWidth)}
              </span>
            </label>
          ) : null}
          {showAnnotationFontSize ? (
            <label className="flex min-w-40 items-center gap-2 text-xs text-text-muted">
              <span className="shrink-0">{t('imageEditor.v3.toolSettings.fontSize')}</span>
              <UiRangeInput
                aria-label={t('imageEditor.v3.toolSettings.fontSize')}
                min={8}
                max={256}
                value={annotationFontSize}
                onChange={(event) => applyAnnotationStyle({
                  fontSize: Number(event.currentTarget.value),
                })}
                onPointerUp={commitAnnotationStyle}
                onPointerCancel={annotationPreview.cancel}
                onBlur={commitAnnotationStyle}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                    commitAnnotationStyle()
                  }
                }}
              />
              <span className="w-8 text-right tabular-nums text-text-dark">
                {Math.round(annotationFontSize)}
              </span>
            </label>
          ) : null}
          {showAnnotationCalloutShape ? (
            <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
              <span>{t('imageEditor.v3.toolSettings.calloutShape')}</span>
              <UiSelect
                className="!h-8 w-24"
                aria-label={t('imageEditor.v3.toolSettings.calloutShape')}
                value={annotationCalloutShape}
                onChange={(event) => {
                  applyAnnotationStyle({
                    calloutShape: event.currentTarget.value as 'rect' | 'ellipse',
                  })
                  queueMicrotask(commitAnnotationStyle)
                }}
              >
                <option value="rect">{t('imageEditor.v3.toolSettings.rect')}</option>
                <option value="ellipse">{t('imageEditor.v3.toolSettings.ellipse')}</option>
              </UiSelect>
            </label>
          ) : null}
        </>
      ) : null}
      {selectionLike ? (
        <div
          role="group"
          aria-label={t('imageEditor.v3.selection.combineMode')}
          className="flex shrink-0 items-center gap-1"
        >
          {(['replace', 'add', 'subtract', 'intersect'] as const).map((mode) => {
            const disabled = !allowedSelectionModes.includes(mode)
            const unavailable = disabled
              ? t('imageEditor.v3.selection.replaceOnly')
              : undefined
            return (
              <UiChipButton
                key={mode}
                selectionRole="navigation"
                active={session.toolSettings.selectionCombineMode === mode}
                disabled={disabled}
                title={unavailable}
                onClick={() => setToolSetting(
                  controller.sessionId,
                  'selectionCombineMode',
                  mode,
                )}
              >
                {t(`imageEditor.v3.selection.${mode}`)}
              </UiChipButton>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ImageEditorCommandBarV3({
  controller,
  bus,
  toolbarLeading,
  toolbarActions,
}: ImageEditorCommandBarV3Props): JSX.Element {
  const { t } = useTranslation('ui')
  const EditorIcon = ICON_TOOL_IMAGE_EDIT
  const zoom = useImageEditorInteractionStoreV3(
    (state) => state.viewportZoomBySession[controller.sessionId] ?? 1,
  )

  return (
    <header
      data-command-stack
      className="shrink-0 border-b border-border-dark bg-panel"
    >
      <div data-command-bar className="flex h-12 min-w-0 items-center gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {toolbarLeading}
          <EditorIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-text-dark">
            {t('imageEditor.v3.title')}
          </span>
        </div>
        <div className="mx-1 h-5 w-px shrink-0 bg-border-dark" aria-hidden="true" />
        <UiIconButton
          className="h-8 w-8"
          showBorder={false}
          appearance="hover-only"
          disabled={!controller.canUndo}
          aria-label={t('imageEditor.actions.undo')}
          title={t('imageEditor.actions.undo')}
          onClick={controller.undo}
        >
          <Undo2 className="h-4 w-4" />
        </UiIconButton>
        <UiIconButton
          className="h-8 w-8"
          showBorder={false}
          appearance="hover-only"
          disabled={!controller.canRedo}
          aria-label={t('imageEditor.actions.redo')}
          title={t('imageEditor.actions.redo')}
          onClick={controller.redo}
        >
          <Redo2 className="h-4 w-4" />
        </UiIconButton>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="hidden text-xs tabular-nums text-text-muted sm:inline">
            {t('imageEditor.v3.revision', { revision: controller.document.revision })}
          </span>
          <span className="w-12 text-right text-xs tabular-nums text-text-muted">
            {Math.round(zoom * 100)}%
          </span>
          {toolbarActions}
        </div>
      </div>
      <ToolParameterBar controller={controller} bus={bus} />
    </header>
  )
}
