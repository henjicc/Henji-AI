import { getDb } from './db'
import type { CameraStageRenderTaskStorage, CameraStageRenderTaskSnapshotDto } from './camera-stage-render-task-registry'

/** 原生任务回执独立于窗口，确认消费后仍保留原请求身份，避免重启重复输出。 */
export const cameraStageRenderTaskStorage: CameraStageRenderTaskStorage = {
  load() {
    const db = getDb()
    db.exec('CREATE TABLE IF NOT EXISTS camera_stage_render_tasks (request_id TEXT PRIMARY KEY, record_json TEXT NOT NULL)')
    return (db.prepare('SELECT record_json FROM camera_stage_render_tasks').all() as Array<{ record_json: string }>).map((row) => JSON.parse(row.record_json) as CameraStageRenderTaskSnapshotDto)
  },
  save(task) {
    getDb().prepare('INSERT OR REPLACE INTO camera_stage_render_tasks VALUES (?, ?)').run(task.requestId, JSON.stringify(task))
  },
}
