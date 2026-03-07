import { convertFileSrc } from '@tauri-apps/api/core'
import type { Viewport } from '@xyflow/react'
import { fileToBlobSrc } from '@/utils/save'
import { getNodeDefinition } from '@/workspaces/canvas/domain/nodeRegistry'
import {
  CANVAS_NODE_TYPES,
  type CanvasFlowNode,
  type CanvasNodeType,
  type MediaType,
} from '@/workspaces/canvas/types'

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export function createNodeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function pickFirst(value?: string): string | undefined {
  if (!value) return undefined
  return value.includes('|||') ? value.split('|||')[0] : value
}

export async function resolveDisplayUrl(
  mediaType: MediaType,
  resultUrl: string,
  filePath?: string
): Promise<string> {
  if (!filePath) return resultUrl
  if (mediaType === 'video') return convertFileSrc(filePath)
  try {
    return await fileToBlobSrc(filePath)
  } catch {
    return convertFileSrc(filePath)
  }
}

export function createNode(type: CanvasNodeType, position: { x: number; y: number }): CanvasFlowNode {
  return {
    id: createNodeId(type),
    type,
    position,
    data: getNodeDefinition(type).createDefaultData(),
  }
}

export function createDefaultCanvasNodes(): CanvasFlowNode[] {
  return [
    createNode(CANVAS_NODE_TYPES.upload, { x: 120, y: 180 }),
    createNode(CANVAS_NODE_TYPES.imageEdit, { x: 520, y: 180 }),
  ]
}
