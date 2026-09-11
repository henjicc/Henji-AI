import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { getDb } from './db'
import { AgentOperationStore } from './agent-runtime/persistence/operation-store'
import type { CameraStageRenderTaskPersistence, CameraStageRenderTaskRecord } from './camera-stage-render-task-registry'

const media = { mediaUrl: z.string(), mediaPath: z.string(), savedPath: z.string(), width: z.number(), height: z.number() }
const resultSchema = z.discriminatedUnion('kind', [
  z.object({ ...media, kind: z.literal('image'), aspectRatio: z.string(), selectedTimeSec: z.number() }),
  z.object({ ...media, kind: z.literal('video'), durationSeconds: z.number(), frameCount: z.number() }),
])
const recordSchema = z.object({
  outputPersistence: z.object({ result: resultSchema, digest: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
  requestId: z.string().min(1), operationId: z.string().uuid().optional(),
  canvasProjectId: z.string().min(1), nodeId: z.string().min(1), cameraStageProjectId: z.string().min(1),
  resolutionPreset: z.enum(['720p', '1080p']), outputKind: z.enum(['image', 'video']), selectedTimeSec: z.number().nonnegative().optional(),
  ownerWebContentsId: z.number().int(), ownerSessionId: z.string(), requestFingerprint: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  phase: z.enum(['preparing', 'rendering', 'encoding']).nullable(), progress: z.number(),
  result: resultSchema.nullable(), message: z.string().nullable(), createdAt: z.number(), updatedAt: z.number(), acknowledgedAt: z.number().optional(),
})

/** 与界面和隐藏渲染窗口共用的领域任务存储；操作日志只引用该任务，不替代任务真相源。 */
export function createCameraStageRenderTaskPersistence(database: () => Database.Database = getDb): CameraStageRenderTaskPersistence {
  function parse(row: unknown): CameraStageRenderTaskRecord | null {
    if (!row) return null
    const { record_json } = z.object({ record_json: z.string() }).parse(row)
    return recordSchema.parse(JSON.parse(record_json))
  }
  return {
    get: (requestId) => parse(database().prepare('SELECT record_json FROM camera_stage_render_tasks WHERE request_id = ?').get(requestId)),
    list: (projectId) => database().prepare('SELECT record_json FROM camera_stage_render_tasks WHERE canvas_project_id = ? AND acknowledged_at IS NULL')
      .all(projectId).map((row) => parse(row)!),
    save: (input, registration) => {
      const record = recordSchema.parse(input)
      const connection = database()
      connection.transaction(() => {
        const operations = new AgentOperationStore(connection)
        if (registration && record.operationId) {
          const original = operations.beginExternalCall(record.operationId, {
            key: record.requestId, source: 'camera_stage_render',
            inputDigest: createHash('sha256').update(record.requestFingerprint).digest('hex'),
            target: { kind: 'camera_stage.render_task', id: record.requestId },
          }, record.ownerWebContentsId)
          if (original.existing) throw new Error('OPERATION_EXTERNAL_UNRESOLVED:原渲染提交已登记，请按原任务核对，不能重复渲染')
        }
        if (registration) {
          connection.prepare(`INSERT INTO camera_stage_render_tasks(request_id,canvas_project_id,record_json,acknowledged_at)
            VALUES (?,?,?,?)`).run(record.requestId, record.canvasProjectId, JSON.stringify(record), record.acknowledgedAt ?? null)
        } else {
          const result = connection.prepare(`UPDATE camera_stage_render_tasks SET record_json = ?, acknowledged_at = ? WHERE request_id = ?`)
            .run(JSON.stringify(record), record.acknowledgedAt ?? null, record.requestId)
          if (!result.changes) throw new Error('RENDER_TASK_NOT_FOUND:原渲染记录不存在，不能以更新代替首次提交')
        }
        if (record.operationId && ['completed', 'failed', 'cancelled'].includes(record.status)) {
          operations.recordExternalCall(record.operationId, record.requestId, {
            state: record.outputPersistence && !record.result ? 'submitted' : 'completed', response: { requestId: record.requestId, status: record.status,
              canvasProjectId: record.canvasProjectId, nodeId: record.nodeId, result: record.result, message: record.message },
          })
        }
      }).immediate()
    },
  }
}
