import type { HandleType, Viewport } from '@xyflow/react'
import {
  type CanvasNode,
  type CanvasNodeType,
  DEFAULT_NODE_WIDTH,
} from '@/features/canvas/domain/canvasNodes'
import {
  canNodeTypeStartManualConnection,
  getConnectMenuNodeTypes,
} from '@/features/canvas/domain/nodeRegistry'

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

/*
 * 画布内部的局部 z 刻度。
 *
 * 这套刻度与全局浮层层级（`src/core/theme/zLayers.ts` / Tailwind 的 z-* 语义类）
 * 是两套独立体系：画布内的层叠由 ReactFlow 自己管理节点 z-index，数值区间与全局
 * 浮层不可比较，也不要互相套用。画布整体作为一个元素参与全局层级即可。
 */

/** Alt 拖拽复制时的临时副本，需要盖住普通节点 */
export const ALT_DRAG_COPY_Z_INDEX = 2000

/** minimap 需要盖住包括 Alt 拖拽副本在内的所有画布内元素 */
export const CANVAS_MINIMAP_Z_INDEX = 10000

export interface PendingConnectStart {
  nodeId: string
  handleType: HandleType
  /** 起拖的具体 handle id（如 'source'/'target'/'param:__image'），用于完成连接时定位对端端口 */
  handleId?: string | null
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

export type CanvasMediaKind = 'image' | 'video' | 'audio'
export type ClipboardMediaKind = CanvasMediaKind

export interface ClipboardMediaFile {
  kind: ClipboardMediaKind
  file: File
}

const CLIPBOARD_MEDIA_KIND_BY_PREFIX: Array<{ kind: ClipboardMediaKind; prefix: string; extFallback: string }> = [
  { kind: 'image', prefix: 'image/', extFallback: 'png' },
  { kind: 'video', prefix: 'video/', extFallback: 'mp4' },
  { kind: 'audio', prefix: 'audio/', extFallback: 'mp3' },
]

const MEDIA_KIND_BY_EXTENSION: Readonly<Record<string, CanvasMediaKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  avif: 'image',
  svg: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  opus: 'audio',
  pcm: 'audio',
}

function matchClipboardMediaKind(mimeType: string): ClipboardMediaKind | null {
  return CLIPBOARD_MEDIA_KIND_BY_PREFIX.find((entry) => mimeType.startsWith(entry.prefix))?.kind ?? null
}

export function resolveMediaFileKind(file: Pick<File, 'name' | 'type'>): CanvasMediaKind | null {
  const mimeKind = matchClipboardMediaKind(file.type.toLowerCase())
  if (mimeKind) {
    return mimeKind
  }

  const extension = file.name.split(/[?#]/, 1)[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  return extension ? MEDIA_KIND_BY_EXTENSION[extension] ?? null : null
}

export function resolveMediaFiles(files: FileList | readonly File[]): ClipboardMediaFile[] {
  return Array.from(files).flatMap((file) => {
    const kind = resolveMediaFileKind(file)
    return kind ? [{ kind, file }] : []
  })
}

/**
 * 解析剪贴板中的媒体文件：优先取真实文件（如从文件管理器复制，带文件名/路径），
 * 兼容截图等非路径格式的媒体数据（DataTransferItem 只有 MIME 类型、没有文件名）。
 */
export function resolveClipboardMediaFile(event: ClipboardEvent): ClipboardMediaFile | null {
  const clipboardData = event.clipboardData
  if (!clipboardData) {
    return null
  }

  const files = clipboardData.files
  if (files && files.length > 0) {
    const [media] = resolveMediaFiles(files)
    if (media) return media
  }

  const clipboardItems = clipboardData.items
  if (!clipboardItems) {
    return null
  }

  for (const item of Array.from(clipboardItems)) {
    const kind = matchClipboardMediaKind(item.type)
    if (!kind) {
      continue
    }

    const file = item.getAsFile()
    if (!file) {
      continue
    }

    const existingName = typeof file.name === 'string' ? file.name.trim() : ''
    if (existingName) {
      return { kind, file }
    }

    const fallbackExt = CLIPBOARD_MEDIA_KIND_BY_PREFIX.find((entry) => entry.kind === kind)?.extFallback ?? 'bin'
    const subtype = item.type.split('/')[1]?.split('+')[0] || fallbackExt
    return {
      kind,
      file: new File([file], `pasted-${kind}.${subtype}`, {
        type: file.type || item.type,
        lastModified: Date.now(),
      }),
    }
  }

  return null
}

export function resolveClipboardImageFile(event: ClipboardEvent): File | null {
  const media = resolveClipboardMediaFile(event)
  return media?.kind === 'image' ? media.file : null
}

export function resolveAllowedNodeTypes(
  handleType: HandleType,
  fromNodeType?: CanvasNodeType
): CanvasNodeType[] {
  return getConnectMenuNodeTypes(handleType, fromNodeType)
}

export function canNodeTypeBeManualConnectionSource(type: CanvasNodeType): boolean {
  return canNodeTypeStartManualConnection(type)
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
