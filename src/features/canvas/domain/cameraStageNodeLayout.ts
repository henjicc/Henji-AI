import { CANVAS_NODE_TYPES, type CanvasNode } from './canvasNodes'

function ratioOf(aspectRatio: unknown): number {
  const [width, height] = typeof aspectRatio === 'string' ? aspectRatio.split(':').map(Number) : []
  return width > 0 && height > 0 ? width / height : 16 / 9
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 3D 镜头参考节点就是画面：高只由宽和画面比例决定。
 * 外框（ReactFlow 的 width/height/style）与画面必须同一份尺寸，否则缩放手柄按外框比例缩、画面按比例画，
 * 多出的部分成了看不见却能点的空白；旧画布里的高还算着已删掉的底部一行，打开时一并改正。
 */
export function fitCameraStageNodeToAspect(node: CanvasNode): CanvasNode {
  if (node.type !== CANVAS_NODE_TYPES.cameraStage) return node
  const width = positive(node.width) ?? positive(node.style?.width)
  if (!width) return node
  const height = Math.round(width / ratioOf(node.data.aspectRatio))
  const currentHeight = positive(node.height) ?? positive(node.style?.height)
  if (currentHeight === height) return node
  return { ...node, width, height, measured: { ...node.measured, width, height }, style: { ...node.style, width, height } }
}
