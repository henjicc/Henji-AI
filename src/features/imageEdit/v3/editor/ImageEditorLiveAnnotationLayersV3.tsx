import type { MutableRefObject } from 'react'
import { Group, Transformer } from 'react-konva'
import Konva from 'konva'

import type { MarkItem, MarkToolType } from '@/core/imageEdit/types'
import { ANNOTATION_TRANSFORMER_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { stabilizeStraightArrowBounds } from '@/features/imageMark/domain/arrowGeometry'
import { labelRefPoint } from '@/features/imageMark/domain/geometry'
import {
  resolveLabelFontSize,
  resolveTextBaseSize,
} from '@/features/imageMark/domain/metrics'
import { ArrowCurveControl } from '@/features/imageMark/editor/ArrowCurveControl'
import { MarkShapeNode } from '@/features/imageMark/editor/markShapes'
import { applyNodeDragToMark, applyNodeTransformToMark } from '@/features/imageMark/editor/nodeSync'
import type { TextEditorState } from '@/features/imageMark/editor/shared'

import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import {
  multiplyAnnotationMatricesV3,
  type AnnotationMatrixV3,
} from './annotationGeometryV3'
import type { EditableAnnotationLayerV3 } from './annotationModelV3'

const EMPTY_MOSAIC_SOURCE = (): HTMLCanvasElement | null => null
const IMAGE_EDITOR_ANNOTATION_ANCHOR_SIZE_PX = 8

function mapTool(tool: ImageEditorToolIdV3): MarkToolType {
  if (tool === 'move') return 'select'
  if (tool.startsWith('annotation-')) return tool.slice('annotation-'.length) as MarkToolType
  return 'select'
}

function screenTransform(
  matrix: AnnotationMatrixV3,
  widthScale: number,
  heightScale: number,
): ReturnType<Konva.Transform['decompose']> {
  const scaled = multiplyAnnotationMatricesV3(
    [widthScale, 0, 0, heightScale, 0, 0],
    matrix,
  )
  return new Konva.Transform([...scaled]).decompose()
}

interface ImageEditorLiveAnnotationLayersV3Props {
  activeTool: ImageEditorToolIdV3
  entries: readonly EditableAnnotationLayerV3[]
  selectedEntry: EditableAnnotationLayerV3 | null
  selectedItem: MarkItem | null
  activeLabelId: string | null
  textEditor: TextEditorState | null
  draft: { matrix: AnnotationMatrixV3; annotation: MarkItem } | null
  widthScale: number
  heightScale: number
  sourceWidth: number
  sourceHeight: number
  stageScale: number
  numberValues: ReadonlyMap<string, number>
  shapeRefs: MutableRefObject<Map<string, Konva.Node>>
  labelRefs: MutableRefObject<Map<string, Konva.Node>>
  transformerRef: MutableRefObject<Konva.Transformer | null>
  onSelect: (entry: EditableAnnotationLayerV3, id: string, label?: boolean) => void
  onCommitItem: (entry: EditableAnnotationLayerV3, item: MarkItem) => void
  onOpenTextEditor: (entry: EditableAnnotationLayerV3, item: MarkItem) => void
}

export function ImageEditorLiveAnnotationLayersV3({
  activeTool,
  entries,
  selectedEntry,
  selectedItem,
  activeLabelId,
  textEditor,
  draft,
  widthScale,
  heightScale,
  sourceWidth,
  sourceHeight,
  stageScale,
  numberValues,
  shapeRefs,
  labelRefs,
  transformerRef,
  onSelect,
  onCommitItem,
  onOpenTextEditor,
}: ImageEditorLiveAnnotationLayersV3Props): JSX.Element {
  const selectedArrow = selectedItem?.type === 'arrow' ? selectedItem : null
  const selectedIsLabel = Boolean(selectedItem && activeLabelId === selectedItem.id)
  const keepRatio = selectedIsLabel || selectedItem?.type === 'text' || selectedItem?.type === 'number'
  return (
    <>
      {entries.map((entry) => {
        const isSelectedLayer = selectedEntry?.layer.id === entry.layer.id
        return (
          <Group key={entry.layer.id} {...screenTransform(entry.matrix, widthScale, heightScale)}>
            {entry.layer.annotations.map((item) => {
              if (textEditor?.kind === 'text' && textEditor.itemId === item.id) return null
              return (
                <MarkShapeNode
                  key={item.id}
                  item={item}
                  numberValue={numberValues.get(item.id) ?? 0}
                  imageWidth={sourceWidth}
                  imageHeight={sourceHeight}
                  getMosaicSource={EMPTY_MOSAIC_SOURCE}
                  draggable={!entry.locked}
                  listening
                  strokeScaleEnabled
                  opacity={entry.layer.opacity}
                  hideLabel={textEditor?.kind === 'label' && textEditor.itemId === item.id}
                  bindRef={(id, node) => {
                    if (node) shapeRefs.current.set(id, node)
                    else shapeRefs.current.delete(id)
                  }}
                  bindLabelRef={(id, node) => {
                    if (node) labelRefs.current.set(id, node)
                    else labelRefs.current.delete(id)
                  }}
                  onSelect={(id) => onSelect(entry, id)}
                  onSelectLabel={(id) => onSelect(entry, id, true)}
                  onDragEnd={(current, event) => onCommitItem(
                    entry,
                    applyNodeDragToMark(current, event.target),
                  )}
                  onTransformEnd={(current, event) => onCommitItem(
                    entry,
                    applyNodeTransformToMark(current, event.target),
                  )}
                  onDblClick={(current) => onOpenTextEditor(entry, current)}
                  onLabelDragEnd={(current, node) => {
                    const reference = labelRefPoint(current)
                    onCommitItem(entry, {
                      ...current,
                      labelDx: node.x() - reference.x,
                      labelDy: node.y() - reference.y,
                    })
                  }}
                  onLabelTransformEnd={(current, node) => {
                    const scale = Math.max(node.scaleX(), node.scaleY())
                    const reference = labelRefPoint(current)
                    node.scaleX(1)
                    node.scaleY(1)
                    onCommitItem(entry, {
                      ...current,
                      labelFontSize: Math.max(8, Math.round(resolveLabelFontSize(
                        current,
                        resolveTextBaseSize(sourceWidth, sourceHeight),
                      ) * scale)),
                      labelDx: node.x() - reference.x,
                      labelDy: node.y() - reference.y,
                    })
                  }}
                />
              )
            })}
            {isSelectedLayer ? (
              <>
                <Transformer
                  ref={(node) => { transformerRef.current = node }}
                  boundBoxFunc={(oldBox, newBox) => {
                    const next = selectedArrow
                      ? stabilizeStraightArrowBounds(selectedArrow, oldBox, newBox)
                      : newBox
                    return next.width < 5 || next.height < 5 ? oldBox : next
                  }}
                  rotateEnabled={false}
                  borderStroke={ANNOTATION_TRANSFORMER_HEX}
                  anchorStroke={ANNOTATION_TRANSFORMER_HEX}
                  anchorFill={WHITE_HEX}
                  anchorSize={IMAGE_EDITOR_ANNOTATION_ANCHOR_SIZE_PX}
                  ignoreStroke
                  keepRatio={keepRatio}
                  enabledAnchors={keepRatio
                    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                    : ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']}
                />
                <ArrowCurveControl
                  selectedArrow={selectedArrow}
                  tool={mapTool(activeTool)}
                  activeLabelId={activeLabelId}
                  scale={stageScale}
                  items={entry.layer.annotations}
                  shapeRefs={shapeRefs}
                  transformerRef={transformerRef}
                  onItemsUpdated={(items) => {
                    const updated = items.find(({ id }) => id === selectedArrow?.id)
                    if (updated) onCommitItem(entry, updated)
                  }}
                />
              </>
            ) : null}
          </Group>
        )
      })}
      {draft ? (
        <Group {...screenTransform(draft.matrix, widthScale, heightScale)} listening={false}>
          <MarkShapeNode
            item={draft.annotation}
            imageWidth={sourceWidth}
            imageHeight={sourceHeight}
            getMosaicSource={EMPTY_MOSAIC_SOURCE}
            draggable={false}
            listening={false}
            strokeScaleEnabled
            opacity={0.8}
          />
        </Group>
      ) : null}
    </>
  )
}
