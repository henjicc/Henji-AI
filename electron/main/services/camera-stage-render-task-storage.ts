import { getDb } from './db'
import { databaseLocations } from './db-locations'
import type { CameraStageRenderTaskStorage, CameraStageRenderTaskSnapshotDto } from './camera-stage-render-task-registry'

/**
 * 原生任务回执独立于窗口，确认消费后仍保留原请求身份，避免重启重复输出。
 * 表由迁移账本第 12 项创建；回执里的文件位置整份按位置写法存储（实施方案 2.5）。
 */
export const cameraStageRenderTaskStorage: CameraStageRenderTaskStorage = {
  load() {
    const rows = getDb().prepare('SELECT record_json FROM camera_stage_render_tasks').all() as Array<{ record_json: string }>
    return databaseLocations.use((scope) => rows.map((row) => scope.decodeValue(JSON.parse(row.record_json) as unknown) as CameraStageRenderTaskSnapshotDto))
  },
  save(task) {
    const stored = databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(task)))
    getDb().prepare('INSERT OR REPLACE INTO camera_stage_render_tasks VALUES (?, ?)').run(task.requestId, stored)
  },
}
