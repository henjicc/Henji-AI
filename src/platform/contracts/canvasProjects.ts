import type { Viewport } from '@xyflow/react'

export interface CanvasProjectPlatformSummary {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface CanvasProjectPlatformSnapshot {
  nodes: DynamicValue[]
  edges: DynamicValue[]
  viewport: Viewport
}

export interface CanvasProjectPlatformRecord extends CanvasProjectPlatformSummary, CanvasProjectPlatformSnapshot {}

export interface CanvasProjectsPlatform {
  listProjects(): Promise<CanvasProjectPlatformSummary[]>
  createProject(id: string, name: string, snapshot: CanvasProjectPlatformSnapshot): Promise<CanvasProjectPlatformRecord>
  getProject(projectId: string): Promise<CanvasProjectPlatformRecord | null>
  renameProject(projectId: string, name: string): Promise<void>
  saveProjectSnapshot(projectId: string, snapshot: CanvasProjectPlatformSnapshot): Promise<void>
  deleteProject(projectId: string): Promise<void>
}
