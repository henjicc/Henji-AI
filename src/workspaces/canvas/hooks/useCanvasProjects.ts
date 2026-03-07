import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'
import {
  canvasProjectService,
  type CanvasProjectRecord,
  type CanvasProjectSummary,
} from '@/services/canvasProjects'
import type { CanvasFlowEdge, CanvasFlowNode, CanvasFlowSnapshot } from '@/workspaces/canvas/types'

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
const SAVE_DEBOUNCE_MS = 360
let runtimeCurrentProjectId: string | null = null

export interface ActiveCanvasProject {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  viewport: Viewport
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function coerceViewport(input: unknown): Viewport {
  if (!isRecord(input)) return DEFAULT_VIEWPORT
  const x = Number(input.x)
  const y = Number(input.y)
  const zoom = Number(input.zoom)
  return {
    x: Number.isFinite(x) ? x : DEFAULT_VIEWPORT.x,
    y: Number.isFinite(y) ? y : DEFAULT_VIEWPORT.y,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_VIEWPORT.zoom,
  }
}

function coerceNodes(input: unknown): CanvasFlowNode[] {
  if (!Array.isArray(input)) return []
  return input.filter((node): node is CanvasFlowNode => {
    if (!isRecord(node)) return false
    if (typeof node.id !== 'string') return false
    if (typeof node.type !== 'string') return false
    if (!isRecord(node.position)) return false
    return Number.isFinite(Number(node.position.x)) && Number.isFinite(Number(node.position.y))
  })
}

function coerceEdges(input: unknown): CanvasFlowEdge[] {
  if (!Array.isArray(input)) return []
  return input.filter((edge): edge is CanvasFlowEdge => {
    if (!isRecord(edge)) return false
    return typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string'
  })
}

function toActiveProject(record: CanvasProjectRecord): ActiveCanvasProject {
  return {
    id: record.id,
    name: record.name,
    nodeCount: record.nodeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nodes: coerceNodes(record.nodes),
    edges: coerceEdges(record.edges),
    viewport: coerceViewport(record.viewport),
  }
}

export interface UseCanvasProjectsReturn {
  projects: CanvasProjectSummary[]
  activeProject: ActiveCanvasProject | null
  loading: boolean
  creating: boolean
  isOpeningProject: boolean
  saving: boolean
  error: string | null
  createAndOpen: (name: string) => Promise<void>
  openProject: (projectId: string) => Promise<void>
  closeProject: () => void
  deleteProject: (projectId: string) => Promise<void>
  renameProject: (projectId: string, name: string) => Promise<void>
  queueSnapshotSave: (snapshot: CanvasFlowSnapshot) => void
  reloadProjects: () => Promise<void>
}

export function useCanvasProjects(): UseCanvasProjectsReturn {
  const [projects, setProjects] = useState<CanvasProjectSummary[]>([])
  const [activeProject, setActiveProject] = useState<ActiveCanvasProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [isOpeningProject, setIsOpeningProject] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeProjectIdRef = useRef<string | null>(null)
  const openRequestSeqRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<CanvasFlowSnapshot | null>(null)

  const reloadProjects = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await canvasProjectService.listProjects()
      setProjects(list)
      if (runtimeCurrentProjectId && !list.some((item) => item.id === runtimeCurrentProjectId)) {
        runtimeCurrentProjectId = null
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const openProject = useCallback(async (projectId: string): Promise<void> => {
    const requestSeq = ++openRequestSeqRef.current
    setIsOpeningProject(true)
    try {
      const project = await canvasProjectService.getProject(projectId)
      if (requestSeq !== openRequestSeqRef.current) return
      if (!project) {
        throw new Error('项目不存在或已被删除')
      }
      setActiveProject(toActiveProject(project))
      activeProjectIdRef.current = project.id
      runtimeCurrentProjectId = project.id
      setError(null)
    } catch (err) {
      if (requestSeq !== openRequestSeqRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestSeq === openRequestSeqRef.current) {
        setIsOpeningProject(false)
      }
    }
  }, [])

  const createAndOpen = useCallback(async (name: string): Promise<void> => {
    setCreating(true)
    try {
      const created = await canvasProjectService.createProject(name)
      await reloadProjects()
      await openProject(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [openProject, reloadProjects])

  const closeProject = useCallback(() => {
    openRequestSeqRef.current += 1
    const projectId = activeProjectIdRef.current
    const fallbackSnapshot = activeProject
      ? { nodes: activeProject.nodes, edges: activeProject.edges, viewport: activeProject.viewport }
      : null
    const snapshot = pendingSnapshotRef.current ?? fallbackSnapshot

    setActiveProject(null)
    activeProjectIdRef.current = null
    runtimeCurrentProjectId = null
    setIsOpeningProject(false)
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    pendingSnapshotRef.current = null
    setSaving(false)
    if (projectId && snapshot) {
      void canvasProjectService.saveProjectSnapshot(projectId, snapshot).then(() => reloadProjects()).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
  }, [activeProject, reloadProjects])

  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    await canvasProjectService.deleteProject(projectId)
    if (runtimeCurrentProjectId === projectId) {
      runtimeCurrentProjectId = null
    }
    if (activeProjectIdRef.current === projectId) {
      closeProject()
    }
    await reloadProjects()
  }, [closeProject, reloadProjects])

  const renameProject = useCallback(async (projectId: string, name: string): Promise<void> => {
    const nextName = name.trim()
    if (!nextName) return

    await canvasProjectService.renameProject(projectId, nextName)
    setActiveProject((prev) => {
      if (!prev || prev.id !== projectId) return prev
      return { ...prev, name: nextName }
    })
    await reloadProjects()
  }, [reloadProjects])

  const flushPendingSave = useCallback(async (): Promise<void> => {
    const projectId = activeProjectIdRef.current
    const snapshot = pendingSnapshotRef.current
    if (!projectId || !snapshot) {
      setSaving(false)
      return
    }

    pendingSnapshotRef.current = null
    try {
      await canvasProjectService.saveProjectSnapshot(projectId, snapshot)
      await reloadProjects()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [reloadProjects])

  const queueSnapshotSave = useCallback((snapshot: CanvasFlowSnapshot) => {
    const projectId = activeProjectIdRef.current
    if (!projectId) return

    pendingSnapshotRef.current = snapshot
    setSaving(true)
    setActiveProject((prev) => {
      if (!prev || prev.id !== projectId) return prev
      return {
        ...prev,
        nodeCount: snapshot.nodes.length,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        viewport: snapshot.viewport,
      }
    })

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }, [flushPendingSave])

  useEffect(() => {
    void reloadProjects()
  }, [reloadProjects])

  useEffect(() => {
    if (activeProject || loading || isOpeningProject) return
    if (!runtimeCurrentProjectId) return
    void openProject(runtimeCurrentProjectId)
  }, [activeProject, loading, isOpeningProject, openProject])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  return useMemo(() => ({
    projects,
    activeProject,
    loading,
    creating,
    isOpeningProject,
    saving,
    error,
    createAndOpen,
    openProject,
    closeProject,
    deleteProject,
    renameProject,
    queueSnapshotSave,
    reloadProjects,
  }), [
    projects,
    activeProject,
    loading,
    creating,
    isOpeningProject,
    saving,
    error,
    createAndOpen,
    openProject,
    closeProject,
    deleteProject,
    renameProject,
    queueSnapshotSave,
    reloadProjects,
  ])
}
