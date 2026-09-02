import { useCallback, useMemo, useRef, useState } from 'react'

import type { MarkItem } from '@/core/imageEdit/types'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens'
import { isLabeledMark } from '@/features/imageMark/domain/types'
import { resolveLabelPlacement } from '@/features/imageMark/domain/metrics'
import type { TextEditorState } from '@/features/imageMark/editor/shared'

import type { ImageEditorToolSettingsV3 } from '../store/imageEditorSessionStoreV3'
import { mapAnnotationPointV3, type AnnotationMatrixV3 } from './annotationGeometryV3'
import type { EditableAnnotationLayerV3 } from './annotationModelV3'
import type { ImageEditorV3Controller } from './types'

interface AnnotationTextEditorV3 {
  layerId: string | null
  matrix: AnnotationMatrixV3
  state: TextEditorState
}

interface UseImageEditorAnnotationTextOptionsV3 {
  controller: ImageEditorV3Controller
  entries: readonly EditableAnnotationLayerV3[]
  sourceToOutput: AnnotationMatrixV3
  sourceWidth: number
  sourceHeight: number
  widthScale: number
  heightScale: number
  toolSettings: ImageEditorToolSettingsV3 | undefined
  addItem: (entry: EditableAnnotationLayerV3 | null, item: MarkItem) => string
  commitItem: (entry: EditableAnnotationLayerV3, item: MarkItem) => void
  clearSelection: () => void
}

export function useImageEditorAnnotationTextV3({
  controller,
  entries,
  sourceToOutput,
  sourceWidth,
  sourceHeight,
  widthScale,
  heightScale,
  toolSettings,
  addItem,
  commitItem,
  clearSelection,
}: UseImageEditorAnnotationTextOptionsV3) {
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [textEditor, setTextEditor] = useState<AnnotationTextEditorV3 | null>(null)

  const focusTextEditor = useCallback(() => {
    requestAnimationFrame(() => {
      textInputRef.current?.focus()
      textInputRef.current?.select()
    })
  }, [])

  const openTextEditor = useCallback((
    entry: EditableAnnotationLayerV3 | null,
    item: MarkItem | null,
    point?: readonly [number, number],
  ) => {
    const matrix = entry?.matrix ?? sourceToOutput
    const fontSize = toolSettings?.annotationFontSize ?? 32
    const color = toolSettings?.annotationColor ?? ANNOTATION_DEFAULT_STROKE_HEX
    if (item?.type === 'text') {
      setTextEditor({
        layerId: entry?.layer.id ?? null,
        matrix,
        state: {
          kind: 'text', itemId: item.id, x: item.x, y: item.y,
          value: item.text, fontSize: item.fontSize, color,
          backgroundColor: item.backgroundColor,
        },
      })
    } else if (item && isLabeledMark(item)) {
      const placement = resolveLabelPlacement(item, sourceWidth, sourceHeight)
      setTextEditor({
        layerId: entry?.layer.id ?? null,
        matrix,
        state: {
          kind: 'label', itemId: item.id, x: placement.x, y: placement.y,
          value: item.label ?? '',
          fontSize: item.labelFontSize ?? Math.max(12, Math.round(fontSize * 0.55)),
          color: item.stroke,
          backgroundColor: item.labelBackgroundColor,
        },
      })
    } else {
      setTextEditor({
        layerId: entry?.layer.id ?? null,
        matrix,
        state: {
          kind: 'text', itemId: null, x: point?.[0] ?? 0, y: point?.[1] ?? 0,
          value: '', fontSize, color,
        },
      })
    }
    focusTextEditor()
  }, [focusTextEditor, sourceHeight, sourceToOutput, sourceWidth, toolSettings])

  const commitTextEditor = useCallback(() => {
    if (!textEditor) return
    const value = textEditor.state.value.replace(/\s+$/, '')
    const entry = entries.find(({ layer }) => layer.id === textEditor.layerId) ?? null
    const item = entry?.layer.annotations.find(({ id }) => id === textEditor.state.itemId) ?? null
    if (textEditor.state.kind === 'label' && item && isLabeledMark(item) && entry) {
      commitItem(entry, value.trim()
        ? { ...item, label: value, labelFontSize: item.labelFontSize ?? textEditor.state.fontSize }
        : { ...item, label: undefined, labelFontSize: undefined })
    } else if (textEditor.state.itemId && item?.type === 'text' && entry) {
      if (value.trim()) commitItem(entry, { ...item, text: value })
      else {
        controller.deleteAnnotation(entry.layer.id, item.id)
        clearSelection()
      }
    } else if (value.trim()) {
      addItem(entry, {
        id: createImageEditIdV3('annotation'), type: 'text',
        x: textEditor.state.x, y: textEditor.state.y,
        text: value, color: textEditor.state.color, fontSize: textEditor.state.fontSize,
      })
    }
    setTextEditor(null)
  }, [addItem, clearSelection, commitItem, controller, entries, textEditor])

  const textPosition = useMemo(() => {
    if (!textEditor) return null
    let x = textEditor.state.x
    let y = textEditor.state.y
    if (textEditor.state.kind === 'label') {
      const entry = entries.find(({ layer }) => layer.id === textEditor.layerId)
      const item = entry?.layer.annotations.find(({ id }) => id === textEditor.state.itemId)
      if (item && isLabeledMark(item)) {
        const placement = resolveLabelPlacement(
          { ...item, label: textEditor.state.value, labelFontSize: textEditor.state.fontSize },
          sourceWidth,
          sourceHeight,
        )
        x = placement.x
        y = placement.y
      }
    }
    const output = mapAnnotationPointV3(textEditor.matrix, [x, y])
    return { x: output[0] * widthScale, y: output[1] * heightScale }
  }, [entries, heightScale, sourceHeight, sourceWidth, textEditor, widthScale])

  return {
    textEditor,
    textInputRef,
    textPosition,
    openTextEditor,
    commitTextEditor,
    updateTextValue: (value: string) => setTextEditor((current) => current
      ? { ...current, state: { ...current.state, value } }
      : current),
    cancelTextEditor: () => setTextEditor(null),
  }
}
