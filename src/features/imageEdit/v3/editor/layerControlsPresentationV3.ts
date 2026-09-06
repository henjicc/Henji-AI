import { mapImageEditTransformPointV3 } from '@/core/imageEdit/v3'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import { LAYER_TRANSFORM_HANDLES_V3, type LayerContentBoundsV3 } from './layerPickingV3'

export interface ImageEditorLayerControlsFrameV3 {
  documentId: string
  revision: number
  layerId: string
  matrix: ImageEditTransformV3
  bounds: LayerContentBoundsV3
  outputWidth: number
  outputHeight: number
  zoom: number
}

/** 控制框唯一的位置来源：同一文档版本内瞬态变换优先，提交新版本后交还文档。 */
export class ImageEditorLayerControlsPresentationV3 {
  private root: HTMLDivElement | null = null
  private frame: ImageEditorLayerControlsFrameV3 | null = null
  private transient: Pick<ImageEditorLayerControlsFrameV3, 'documentId' | 'revision' | 'layerId' | 'matrix'>
    & { bounds: LayerContentBoundsV3 | null } | null = null

  sync(root: HTMLDivElement | null, frame: ImageEditorLayerControlsFrameV3 | null): void {
    this.root = root
    this.frame = frame
    if (!frame || (this.transient && !this.matches(frame, this.transient))) this.transient = null
    this.paint()
  }

  updateTransform(documentId: string, revision: number, layerId: string, matrix: ImageEditTransformV3 | null): void {
    if (!matrix) {
      if (this.transient?.layerId === layerId) this.transient = null
    } else {
      const identity = { documentId, revision, layerId }
      // 资源异步就绪或预览帧刷新不能在同一手势中改变控制框局部边界。
      const bounds = this.transient && this.matches(identity, this.transient) ? this.transient.bounds
        : this.frame && this.matches(identity, this.frame) ? this.frame.bounds : null
      this.transient = { ...identity, matrix: [...matrix], bounds }
    }
    this.paint()
  }

  private matches(a: Pick<ImageEditorLayerControlsFrameV3, 'documentId' | 'revision' | 'layerId'>,
    b: Pick<ImageEditorLayerControlsFrameV3, 'documentId' | 'revision' | 'layerId'>): boolean {
    return a.documentId === b.documentId && a.revision === b.revision && a.layerId === b.layerId
  }

  private paint(): void {
    const frame = this.frame
    if (!frame || !this.root) return
    const transient = this.transient && this.matches(frame, this.transient) ? this.transient : null
    if (transient && !transient.bounds) transient.bounds = frame.bounds
    paintImageEditorLayerControlsV3(this.root, transient?.matrix ?? frame.matrix,
      transient?.bounds ?? frame.bounds, frame.outputWidth, frame.outputHeight, frame.zoom)
  }
}

export function paintImageEditorLayerControlsV3(root: HTMLDivElement | null, matrix: ImageEditTransformV3,
  bounds: LayerContentBoundsV3, outputWidth: number, outputHeight: number, zoom: number): void {
  if (!root) return
  const { x, y, width, height } = bounds
  const local = [[x, y], [x + width / 2, y], [x + width, y], [x + width, y + height / 2],
    [x + width, y + height], [x + width / 2, y + height], [x, y + height], [x, y + height / 2]]
  const points = local.map(([px, py]) => mapImageEditTransformPointV3(matrix, px, py))
  const center = mapImageEditTransformPointV3(matrix, x + width / 2, y + height / 2)
  const top = points[1]
  const dx = top[0] - center[0], dy = top[1] - center[1]
  const length = Math.hypot(dx, dy) || 1
  const screenWidth = root.getBoundingClientRect().width || outputWidth
  const offset = 28 * outputWidth / screenWidth
  points.push([top[0] + dx / length * offset, top[1] + dy / length * offset])
  for (const [index, name] of LAYER_TRANSFORM_HANDLES_V3.entries()) {
    const handle = root.querySelector<HTMLElement>(`[data-layer-transform-handle="${name}"]`)
    if (!handle) continue
    handle.style.left = `${points[index][0] / outputWidth * 100}%`
    handle.style.top = `${points[index][1] / outputHeight * 100}%`
    handle.style.transform = `translate(-50%, -50%) scale(${1 / zoom})`
  }
  const edges = [[0, 2], [2, 4], [4, 6], [6, 0], [1, 8]]
  edges.forEach(([a, b], index) => {
    const edge = root.querySelector<HTMLElement>(`[data-layer-transform-edge="${index}"]`)
    if (!edge) return
    const start = points[a], end = points[b]
    edge.style.left = `${start[0] / outputWidth * 100}%`
    edge.style.top = `${start[1] / outputHeight * 100}%`
    edge.style.width = `${Math.hypot(end[0] - start[0], end[1] - start[1]) / outputWidth * 100}%`
    edge.style.transform = `rotate(${Math.atan2(end[1] - start[1], end[0] - start[0])}rad) scaleY(${1 / zoom})`
  })
}
