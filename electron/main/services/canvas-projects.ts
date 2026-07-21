import { getDb } from './db'

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

export interface CanvasProjectSummaryDto {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface CanvasProjectSnapshotDto {
  nodes: unknown[]
  edges: unknown[]
  viewport: unknown
}

export interface CanvasProjectRecordDto extends CanvasProjectSummaryDto, CanvasProjectSnapshotDto {}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function rowToSummary(row: CanvasProjectRow): CanvasProjectSummaryDto {
  return {
    id: row.id,
    name: row.name,
    nodeCount: Math.max(0, Number(row.node_count ?? 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRecord(row: CanvasProjectRow): CanvasProjectRecordDto {
  return {
    ...rowToSummary(row),
    nodes: safeJsonParse<unknown[]>(row.nodes_json, []),
    edges: safeJsonParse<unknown[]>(row.edges_json, []),
    viewport: safeJsonParse<unknown>(row.viewport_json, { x: 0, y: 0, zoom: 1 }),
  }
}

export function listCanvasProjects(): CanvasProjectSummaryDto[] {
  const rows = getDb().prepare(
    `SELECT id, name, node_count, nodes_json, edges_json, viewport_json, created_at, updated_at
     FROM canvas_projects
     ORDER BY updated_at DESC`
  ).all() as CanvasProjectRow[]
  return rows.map(rowToSummary)
}

export function createCanvasProject(
  id: string,
  name: string,
  snapshot: CanvasProjectSnapshotDto
): CanvasProjectRecordDto {
  getDb().prepare(
    `INSERT INTO canvas_projects (
      id, name, nodes_json, edges_json, viewport_json, node_count
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    JSON.stringify(snapshot.nodes),
    JSON.stringify(snapshot.edges),
    JSON.stringify(snapshot.viewport),
    snapshot.nodes.length
  )

  const created = getCanvasProject(id)
  if (!created) {
    throw new Error('Canvas project created but could not be read back')
  }
  return created
}

export function getCanvasProject(projectId: string): CanvasProjectRecordDto | null {
  const row = getDb().prepare(
    `SELECT id, name, node_count, nodes_json, edges_json, viewport_json, created_at, updated_at
     FROM canvas_projects
     WHERE id = ?
     LIMIT 1`
  ).get(projectId) as CanvasProjectRow | undefined
  return row ? rowToRecord(row) : null
}

export function renameCanvasProject(projectId: string, name: string): void {
  getDb().prepare(
    `UPDATE canvas_projects
     SET name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(name, projectId)
}

export function saveCanvasProjectSnapshot(projectId: string, snapshot: CanvasProjectSnapshotDto): void {
  getDb().prepare(
    `UPDATE canvas_projects
     SET nodes_json = ?, edges_json = ?, viewport_json = ?, node_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    JSON.stringify(snapshot.nodes),
    JSON.stringify(snapshot.edges),
    JSON.stringify(snapshot.viewport),
    snapshot.nodes.length,
    projectId
  )
}

export function deleteCanvasProject(projectId: string): void {
  getDb().prepare('DELETE FROM canvas_projects WHERE id = ?').run(projectId)
}
