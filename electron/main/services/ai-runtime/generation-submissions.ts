import { operationDigest } from '../application-control/operationDigest'
import type { AiGenerateRequestDto } from '@henjicc/ai-sdk'
import { readStringArray, type HostGenerateResponse } from './host-response'
import { getDb } from '../db'
import { databaseLocations } from '../db-locations'

/*
 * 生成提交账本（generation_submissions，迁移账本第 11 项）的唯一读写入口。
 * 回执里的文件位置整份按位置写法存储（实施方案 2.5），读出时换回绝对路径。
 */

function encodeResponse(response: HostGenerateResponse): string {
  return databaseLocations.use((scope) => JSON.stringify(scope.encodeValue(response)))
}

function decodeResponse(text: string): HostGenerateResponse {
  const parsed = JSON.parse(text) as unknown
  const decoded = databaseLocations.use((scope) => scope.decodeValue(parsed)) as HostGenerateResponse
  return { ...decoded, urls: readStringArray(decoded.urls), filePaths: readStringArray(decoded.filePaths) }
}

/** 先记录意图，再允许供应商调用；缺回执始终未知，不重新提交。 */
export function claimGenerationSubmission(requestId: string, request: AiGenerateRequestDto): HostGenerateResponse | null {
  const db = getDb()
  const { requestId: _requestId, ...businessInput } = request
  const digest = operationDigest(businessInput)
  return db.transaction(() => {
    const prior = db.prepare('SELECT input_digest, response_json FROM generation_submissions WHERE request_id = ?').get(requestId) as { input_digest: string; response_json: string | null } | undefined
    if (prior) {
      if (prior.input_digest !== digest) throw new Error('GENERATION_INPUT_CONFLICT:原生成标识已绑定其他输入')
      if (!prior.response_json) throw new Error('GENERATION_OUTCOME_UNKNOWN:原生成已经派发，结果尚待核对，禁止重复提交')
      return decodeResponse(prior.response_json)
    }
    db.prepare('INSERT INTO generation_submissions(request_id,input_digest,response_json,created_at,model_id) VALUES (?, ?, NULL, ?, ?)').run(requestId, digest, Date.now(), request.modelId)
    return null
  })()
}

export function completeGenerationSubmission(requestId: string, response: HostGenerateResponse, phase: 'provider' | 'media' | 'completed' = 'completed'): void {
  getDb().prepare('UPDATE generation_submissions SET response_json = ?, phase = ? WHERE request_id = ?').run(encodeResponse(response), phase, requestId)
}

export function readGenerationSubmissionStage(requestId: string): { phase: string; modelId: string | null } | undefined {
  return getDb().prepare('SELECT phase, model_id AS modelId FROM generation_submissions WHERE request_id = ?').get(requestId) as { phase: string; modelId: string | null } | undefined
}

export function readGenerationSubmission(requestId: string): HostGenerateResponse | null {
  const row = getDb().prepare('SELECT response_json FROM generation_submissions WHERE request_id = ?').get(requestId) as { response_json: string | null } | undefined
  return row?.response_json ? decodeResponse(row.response_json) : null
}

/** 删除一条提交记录（测试夹具清理自己造的数据用）；返回是否删除。 */
export function deleteGenerationSubmission(requestId: string): boolean {
  return getDb().prepare('DELETE FROM generation_submissions WHERE request_id = ?').run(requestId).changes > 0
}

/** 一条提交记录的状态摘要（测试夹具核对幂等用）：不存在返回 null。 */
export function inspectGenerationSubmission(requestId: string): { phase: string; createdAt: number; hasResponse: boolean } | null {
  const row = getDb().prepare('SELECT phase, created_at AS createdAt, response_json IS NOT NULL AS hasResponse FROM generation_submissions WHERE request_id = ?').get(requestId) as { phase: string; createdAt: number; hasResponse: number } | undefined
  return row ? { phase: row.phase, createdAt: row.createdAt, hasResponse: row.hasResponse === 1 } : null
}
