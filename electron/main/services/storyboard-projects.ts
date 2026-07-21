import { getDb } from './db'

interface StoryboardProjectRow {
  id: string
  name: string
  created_at: number | string
  updated_at: number | string
  node_count: number | null
  nodes_json: string
  edges_json: string
  viewport_json: string
  history_json: string
}

export interface StoryboardProjectSummaryDto {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
}

export interface StoryboardProjectRecordDto extends StoryboardProjectSummaryDto {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

function normalizeTimestamp(value: number | string | null | undefined): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return Date.now()
}

function rowToSummary(row: StoryboardProjectRow): StoryboardProjectSummaryDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    nodeCount: Math.max(0, Number(row.node_count ?? 0)),
  }
}

function rowToRecord(row: StoryboardProjectRow): StoryboardProjectRecordDto {
  return {
    ...rowToSummary(row),
    nodesJson: row.nodes_json,
    edgesJson: row.edges_json,
    viewportJson: row.viewport_json,
    historyJson: row.history_json,
  }
}

export function listStoryboardProjectSummaries(): StoryboardProjectSummaryDto[] {
  const rows = getDb().prepare(
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
     FROM storyboard_projects
     ORDER BY updated_at DESC`
  ).all() as StoryboardProjectRow[]
  return rows.map(rowToSummary)
}

export function getStoryboardProject(projectId: string): StoryboardProjectRecordDto | null {
  const row = getDb().prepare(
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
     FROM storyboard_projects
     WHERE id = ?
     LIMIT 1`
  ).get(projectId) as StoryboardProjectRow | undefined
  return row ? rowToRecord(row) : null
}

export function upsertStoryboardProject(record: StoryboardProjectRecordDto): void {
  getDb().prepare(
    `INSERT INTO storyboard_projects (
      id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      node_count = excluded.node_count,
      nodes_json = excluded.nodes_json,
      edges_json = excluded.edges_json,
      viewport_json = excluded.viewport_json,
      history_json = excluded.history_json`
  ).run(
    record.id,
    record.name,
    normalizeTimestamp(record.createdAt),
    normalizeTimestamp(record.updatedAt),
    Math.max(0, Number(record.nodeCount || 0)),
    record.nodesJson,
    record.edgesJson,
    record.viewportJson,
    record.historyJson
  )
}

export function updateStoryboardProjectViewport(projectId: string, viewportJson: string): void {
  getDb().prepare(
    `UPDATE storyboard_projects
     SET viewport_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(viewportJson, Date.now(), projectId)
}

export function renameStoryboardProject(projectId: string, name: string, updatedAt: number): void {
  getDb().prepare(
    `UPDATE storyboard_projects
     SET name = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, normalizeTimestamp(updatedAt), projectId)
}

export function deleteStoryboardProject(projectId: string): void {
  getDb().prepare('DELETE FROM storyboard_projects WHERE id = ?').run(projectId)
}
