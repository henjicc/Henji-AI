import type { Viewport } from '@xyflow/react'

export interface CanvasProjectSummary {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface CanvasProjectSnapshot {
  nodes: unknown[]
  edges: unknown[]
  viewport: Viewport
}

export interface CanvasProjectRecord extends CanvasProjectSummary, CanvasProjectSnapshot {}
