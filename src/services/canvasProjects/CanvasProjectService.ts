import { getPlatform } from '@/platform'
import type { DbPlatform } from '@/platform/contracts/db'
import type {
  CanvasProjectRecord,
  CanvasProjectSnapshot,
  CanvasProjectSummary,
} from './types'

interface CanvasProjectRow {
  id: string
  name: string
  node_count: number | null
  nodes_json: string
  edges_json: string
  viewport_json: string
  created_at: string
  updated_at: string
}

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function nowProjectName(): string {
  const date = new Date()
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `项目 ${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function createProjectId(): string {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function rowToSummary(row: CanvasProjectRow): CanvasProjectSummary {
  return {
    id: row.id,
    name: row.name,
    nodeCount: Math.max(0, Number(row.node_count ?? 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRecord(row: CanvasProjectRow): CanvasProjectRecord {
  const nodes = safeJsonParse<DynamicValue[]>(row.nodes_json, [])
  const edges = safeJsonParse<DynamicValue[]>(row.edges_json, [])
  const viewport = safeJsonParse<typeof DEFAULT_VIEWPORT>(row.viewport_json, DEFAULT_VIEWPORT)
  return {
    ...rowToSummary(row),
    nodes,
    edges,
    viewport,
  }
}

export class CanvasProjectService {
  private static instance: CanvasProjectService | null = null
  private db: DbPlatform | null = null
  private initializing: Promise<void> | null = null

  static getInstance(): CanvasProjectService {
    if (!CanvasProjectService.instance) {
      CanvasProjectService.instance = new CanvasProjectService()
    }
    return CanvasProjectService.instance
  }

  async init(): Promise<void> {
    if (this.db) return
    if (this.initializing) return this.initializing

    this.initializing = (async () => {
      const platform = getPlatform()
      this.db = platform.db
      await this.createTables()
    })()

    try {
      await this.initializing
    } finally {
      this.initializing = null
    }
  }

  private ensureDb(): DbPlatform {
    if (!this.db) {
      throw new Error('CanvasProjectService not initialized. Please call init() first.')
    }
    return this.db
  }

  private async createTables(): Promise<void> {
    const db = this.ensureDb()
    await db.execute(`
      CREATE TABLE IF NOT EXISTS canvas_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        viewport_json TEXT NOT NULL,
        node_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_canvas_projects_updated_at ON canvas_projects(updated_at DESC)'
    )
  }

  async listProjects(): Promise<CanvasProjectSummary[]> {
    await this.init()
    const db = this.ensureDb()
    const rows = await db.select<CanvasProjectRow>(
      `SELECT id, name, node_count, nodes_json, edges_json, viewport_json, created_at, updated_at
       FROM canvas_projects
       ORDER BY updated_at DESC`
    )
    return rows.map(rowToSummary)
  }

  async createProject(name?: string): Promise<CanvasProjectRecord> {
    await this.init()
    const db = this.ensureDb()
    const projectId = createProjectId()
    const snapshot: CanvasProjectSnapshot = {
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
    }
    await db.execute(
      `INSERT INTO canvas_projects (
          id, name, nodes_json, edges_json, viewport_json, node_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        (name?.trim() || nowProjectName()),
        JSON.stringify(snapshot.nodes),
        JSON.stringify(snapshot.edges),
        JSON.stringify(snapshot.viewport),
        0,
      ]
    )
    const created = await this.getProject(projectId)
    if (!created) {
      throw new Error('项目创建成功，但读取失败')
    }
    return created
  }

  async getProject(projectId: string): Promise<CanvasProjectRecord | null> {
    await this.init()
    const db = this.ensureDb()
    const rows = await db.select<CanvasProjectRow>(
      `SELECT id, name, node_count, nodes_json, edges_json, viewport_json, created_at, updated_at
       FROM canvas_projects
       WHERE id = ?
       LIMIT 1`,
      [projectId]
    )
    if (rows.length === 0) return null
    return rowToRecord(rows[0])
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    await this.init()
    const db = this.ensureDb()
    await db.execute(
      `UPDATE canvas_projects
       SET name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name.trim(), projectId]
    )
  }

  async saveProjectSnapshot(projectId: string, snapshot: CanvasProjectSnapshot): Promise<void> {
    await this.init()
    const db = this.ensureDb()
    const nodeCount = Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0
    await db.execute(
      `UPDATE canvas_projects
       SET nodes_json = ?, edges_json = ?, viewport_json = ?, node_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        JSON.stringify(snapshot.nodes),
        JSON.stringify(snapshot.edges),
        JSON.stringify(snapshot.viewport ?? DEFAULT_VIEWPORT),
        nodeCount,
        projectId,
      ]
    )
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.init()
    const db = this.ensureDb()
    await db.execute('DELETE FROM canvas_projects WHERE id = ?', [projectId])
  }
}

export const canvasProjectService = CanvasProjectService.getInstance()
