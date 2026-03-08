import type { HandleType, Viewport } from '@xyflow/react'
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeType,
  DEFAULT_NODE_WIDTH,
} from '@/features/canvas/domain/canvasNodes'
import { getConnectMenuNodeTypes } from '@/features/canvas/domain/nodeRegistry'

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
export const ALT_DRAG_COPY_Z_INDEX = 2000

export interface PendingConnectStart {
  nodeId: string
  handleType: HandleType
  start?: {
    x: number
    y: number
  }
}

export interface PreviewConnectionVisual {
  d: string
  stroke: string
  strokeWidth: number
  strokeLinecap: 'butt' | 'round' | 'square'
  left: number
  top: number
  width: number
  height: number
}

export interface ClipboardSnapshot {
  nodes: CanvasNode[]
  edges: import('@/features/canvas/domain/canvasNodes').CanvasEdge[]
}

export interface DuplicateOptions {
  explicitOffset?: { x: number; y: number }
  disableOffsetIteration?: boolean
  suppressSelect?: boolean
  suppressPersist?: boolean
}

export interface DuplicateResult {
  firstNodeId: string | null
  idMap: Map<string, string>
}

export interface PreviewConnectionLine {
  start: { x: number; y: number }
  end: { x: number; y: number }
  handleType: HandleType
}

export function getNodeSize(node: CanvasNode): { width: number; height: number } {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : null
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : null
  return {
    width: node.measured?.width ?? styleWidth ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? styleHeight ?? 200,
  }
}

export function hasRectCollision(
  candidateRect: { x: number; y: number; width: number; height: number },
  nodes: CanvasNode[],
  ignoreNodeIds: Set<string>
): boolean {
  const margin = 18
  return nodes.some((node) => {
    if (ignoreNodeIds.has(node.id)) {
      return false
    }
    const size = getNodeSize(node)
    return (
      candidateRect.x < node.position.x + size.width + margin &&
      candidateRect.x + candidateRect.width + margin > node.position.x &&
      candidateRect.y < node.position.y + size.height + margin &&
      candidateRect.y + candidateRect.height + margin > node.position.y
    )
  })
}

export function cloneNodeData<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  const tagName = element.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || element.isContentEditable
}

export function resolveClipboardImageFile(event: ClipboardEvent): File | null {
  const clipboardItems = event.clipboardData?.items
  if (!clipboardItems) {
    return null
  }

  for (const item of Array.from(clipboardItems)) {
    if (!item.type.startsWith('image/')) {
      continue
    }

    const file = item.getAsFile()
    if (!file) {
      continue
    }

    const existingName = typeof file.name === 'string' ? file.name.trim() : ''
    if (existingName) {
      return file
    }

    const subtype = item.type.split('/')[1]?.split('+')[0] || 'png'
    return new File([file], `pasted-image.${subtype}`, {
      type: file.type || item.type,
      lastModified: Date.now(),
    })
  }

  return null
}

export function resolveAllowedNodeTypes(handleType: HandleType): CanvasNodeType[] {
  return getConnectMenuNodeTypes(handleType)
}

export function canNodeTypeBeManualConnectionSource(type: CanvasNodeType): boolean {
  return type === CANVAS_NODE_TYPES.upload || type === CANVAS_NODE_TYPES.exportImage
}

export function canNodeBeManualConnectionSource(
  nodeId: string | null | undefined,
  nodes: CanvasNode[]
): boolean {
  if (!nodeId) {
    return false
  }
  const node = nodes.find((item) => item.id === nodeId)
  return node ? canNodeTypeBeManualConnectionSource(node.type) : false
}

export function getClientPosition(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('clientX' in event && 'clientY' in event) {
    return { x: event.clientX, y: event.clientY }
  }

  const touch = 'changedTouches' in event
    ? event.changedTouches[0] ?? event.touches[0]
    : null
  if (!touch) {
    return null
  }

  return { x: touch.clientX, y: touch.clientY }
}

export function createPreviewPath(line: PreviewConnectionLine): string {
  const { start, end, handleType } = line
  const deltaX = end.x - start.x
  const curveStrength = Math.max(36, Math.min(120, Math.abs(deltaX) * 0.4))
  const handleDirection = handleType === 'source' ? 1 : -1
  const isReverseDrag = deltaX * handleDirection < 0
  const effectiveDirection = isReverseDrag ? -handleDirection : handleDirection
  const startControlX = start.x + effectiveDirection * curveStrength
  const endControlX = end.x - effectiveDirection * curveStrength

  return `M ${start.x} ${start.y} C ${startControlX} ${start.y}, ${endControlX} ${end.y}, ${end.x} ${end.y}`
}
