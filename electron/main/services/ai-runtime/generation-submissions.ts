import { operationDigest } from '../application-control/operationDigest'
import type Database from 'better-sqlite3'
import type { AiGenerateRequestDto, AiGenerateResponseDto } from '@henjicc/ai-sdk'
import { getDb } from '../db'

function database(): Database.Database {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS generation_submissions (
    request_id TEXT PRIMARY KEY, input_digest TEXT NOT NULL, response_json TEXT, created_at INTEGER NOT NULL)`)
  const columns = db.prepare('PRAGMA table_info(generation_submissions)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'phase')) db.exec("ALTER TABLE generation_submissions ADD COLUMN phase TEXT NOT NULL DEFAULT 'provider'")
  if (!columns.some((column) => column.name === 'model_id')) db.exec('ALTER TABLE generation_submissions ADD COLUMN model_id TEXT')
  return db
}

/** 先记录意图，再允许供应商调用；缺回执始终未知，不重新提交。 */
export function claimGenerationSubmission(requestId: string, request: AiGenerateRequestDto): AiGenerateResponseDto | null {
  const db = database()
  const { requestId: _requestId, ...businessInput } = request
  const digest = operationDigest(businessInput)
  return db.transaction(() => {
    const prior = db.prepare('SELECT input_digest, response_json FROM generation_submissions WHERE request_id = ?').get(requestId) as { input_digest: string; response_json: string | null } | undefined
    if (prior) {
      if (prior.input_digest !== digest) throw new Error('GENERATION_INPUT_CONFLICT:原生成标识已绑定其他输入')
      if (!prior.response_json) throw new Error('GENERATION_OUTCOME_UNKNOWN:原生成已经派发，结果尚待核对，禁止重复提交')
      return JSON.parse(prior.response_json) as AiGenerateResponseDto
    }
    db.prepare('INSERT INTO generation_submissions(request_id,input_digest,response_json,created_at,model_id) VALUES (?, ?, NULL, ?, ?)').run(requestId, digest, Date.now(), request.modelId)
    return null
  })()
}

export function completeGenerationSubmission(requestId: string, response: AiGenerateResponseDto, phase: 'provider' | 'media' | 'completed' = 'completed'): void {
  database().prepare('UPDATE generation_submissions SET response_json = ?, phase = ? WHERE request_id = ?').run(JSON.stringify(response), phase, requestId)
}

export function readGenerationSubmissionStage(requestId: string): { phase: string; modelId: string | null } | undefined {
  return database().prepare('SELECT phase, model_id AS modelId FROM generation_submissions WHERE request_id = ?').get(requestId) as { phase: string; modelId: string | null } | undefined
}

export function readGenerationSubmission(requestId: string): AiGenerateResponseDto | null {
  const row = database().prepare('SELECT response_json FROM generation_submissions WHERE request_id = ?').get(requestId) as { response_json: string | null } | undefined
  return row?.response_json ? JSON.parse(row.response_json) as AiGenerateResponseDto : null
}
