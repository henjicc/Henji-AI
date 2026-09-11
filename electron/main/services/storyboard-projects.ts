import { getDb } from './db'
import { clearProjectCover } from './project-covers'
import { validateStoryboardProjectRecord } from './storyboard-project-validation'
import { parseCanvasProjectViewport, CanvasProjectRecordError } from '../../../src/core/canvas/projectRecordCodec'
import { createMainLogger } from './logging'

const logger = createMainLogger('main.storyboard-projects')

function checkedOperation<T>(projectId: string, operation: string, run: () => T): T {
  logger.debug('开始处理工程数据', { event: `storyboard_project.${operation}.start`, context: { projectId } })
  try {
    const result = run()
    logger.debug('完成处理工程数据', { event: `storyboard_project.${operation}.completed`, context: { projectId } })
    return result
  } catch (error) {
    logger.error('工程数据处理失败，保留原内容', {
      event: `storyboard_project.${operation}.failed`, error, context: { projectId,
        ...(error instanceof CanvasProjectRecordError ? { field: error.field, reason: error.reason } : {}) },
    })
    throw error
  }
}

/** 同一写事务检查原件再写入，其他连接不能在检查后抢先损坏原件。 */
function protectedWrite(projectId: string, write: () => void, allowCreate = false): void {
  checkedOperation(projectId, 'write', () => getDb().transaction(() => {
    if (!getStoryboardProject(projectId) && !allowCreate) throw new Error('工程不存在，无法保存或重命名，请返回工程列表重新打开。')
    write()
  }).immediate())
}

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
  cover_path: string | null
}

export interface StoryboardProjectSummaryDto {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  coverPath: string | null
}

export interface StoryboardProjectRecordDto extends StoryboardProjectSummaryDto {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

/** 写入侧不带封面：封面由 project-covers 单独登记，工程自动保存不得把它覆盖成空。 */
export type StoryboardProjectWriteDto = Omit<StoryboardProjectRecordDto, 'coverPath'>

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
    coverPath: row.cover_path ?? null,
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
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json, cover_path
     FROM storyboard_projects
     ORDER BY updated_at DESC`
  ).all() as StoryboardProjectRow[]
  return rows.map(rowToSummary)
}

export function getStoryboardProject(projectId: string): StoryboardProjectRecordDto | null {
  return checkedOperation(projectId, 'read', () => {
  const row = getDb().prepare(
    `SELECT id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json, cover_path
     FROM storyboard_projects
     WHERE id = ?
     LIMIT 1`
  ).get(projectId) as StoryboardProjectRow | undefined
    if (!row) return null
    const record = rowToRecord(row)
    validateStoryboardProjectRecord(record)
    return record
  })
}

export function upsertStoryboardProject(record: StoryboardProjectWriteDto): void {
  protectedWrite(record.id, () => {
  validateStoryboardProjectRecord(record)
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
  }, true)
}

export function updateStoryboardProjectViewport(projectId: string, viewportJson: string): void {
  protectedWrite(projectId, () => {
  parseCanvasProjectViewport(viewportJson)
  getDb().prepare(
    `UPDATE storyboard_projects
     SET viewport_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(viewportJson, Date.now(), projectId)
  })
}

export function renameStoryboardProject(projectId: string, name: string, updatedAt: number): void {
  protectedWrite(projectId, () => {
  getDb().prepare(
    `UPDATE storyboard_projects
     SET name = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, normalizeTimestamp(updatedAt), projectId)
  })
}

export async function deleteStoryboardProject(projectId: string, commit: (write: () => void) => void = (write) => write()): Promise<void> {
  await clearProjectCover('canvas', projectId)
  commit(() => { getDb().prepare('DELETE FROM storyboard_projects WHERE id = ?').run(projectId) })
}
