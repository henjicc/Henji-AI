import { getDb } from './db'
import { clearProjectCover } from './project-covers'

/**
 * 3D 镜头参考场景工程持久化服务层。
 * 结构参照 storyboard-projects：DTO 命名规范、时间戳归一化，scene_json 存整份场景快照。
 */

interface CameraStageProjectRow {
  id: string
  name: string
  created_at: number | string
  updated_at: number | string
  object_count: number | null
  scene_json: string
  cover_path: string | null
}

export interface CameraStageProjectSummaryDto {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
  coverPath: string | null
}

export interface CameraStageProjectRecordDto extends CameraStageProjectSummaryDto {
  sceneJson: string
}

/** 写入侧不带封面：封面由 project-covers 单独登记，场景自动保存不得把它覆盖成空。 */
export type CameraStageProjectWriteDto = Omit<CameraStageProjectRecordDto, 'coverPath'>

function normalizeTimestamp(value: number | string | null | undefined): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return Date.now()
}

function rowToSummary(row: CameraStageProjectRow): CameraStageProjectSummaryDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    objectCount: Math.max(0, Number(row.object_count ?? 0)),
    coverPath: row.cover_path ?? null,
  }
}

function rowToRecord(row: CameraStageProjectRow): CameraStageProjectRecordDto {
  return {
    ...rowToSummary(row),
    sceneJson: row.scene_json,
  }
}

export function listCameraStageProjectSummaries(): CameraStageProjectSummaryDto[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, created_at, updated_at, object_count, scene_json, cover_path
       FROM camera_stage_projects
       ORDER BY updated_at DESC`,
    )
    .all() as CameraStageProjectRow[]
  return rows.map(rowToSummary)
}

export function getCameraStageProject(projectId: string): CameraStageProjectRecordDto | null {
  const row = getDb()
    .prepare(
      `SELECT id, name, created_at, updated_at, object_count, scene_json, cover_path
       FROM camera_stage_projects
       WHERE id = ?
       LIMIT 1`,
    )
    .get(projectId) as CameraStageProjectRow | undefined
  return row ? rowToRecord(row) : null
}

export function upsertCameraStageProject(record: CameraStageProjectWriteDto): void {
  getDb()
    .prepare(
      `INSERT INTO camera_stage_projects (
        id, name, created_at, updated_at, object_count, scene_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      -- 冲突更新时不覆盖 created_at，保留工程首次创建时间
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        updated_at = excluded.updated_at,
        object_count = excluded.object_count,
        scene_json = excluded.scene_json`,
    )
    .run(
      record.id,
      record.name,
      normalizeTimestamp(record.createdAt),
      normalizeTimestamp(record.updatedAt),
      Math.max(0, Number(record.objectCount || 0)),
      record.sceneJson,
    )
}

export function renameCameraStageProject(projectId: string, name: string, updatedAt: number): void {
  getDb()
    .prepare(
      `UPDATE camera_stage_projects
       SET name = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(name, normalizeTimestamp(updatedAt), projectId)
}

export async function deleteCameraStageProject(projectId: string): Promise<void> {
  await clearProjectCover('camera-stage', projectId)
  getDb().prepare('DELETE FROM camera_stage_projects WHERE id = ?').run(projectId)
}
