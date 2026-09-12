import { EmbeddedAgentService } from '../services/embedded-agent/service'
import { listEmbeddedModels } from '../services/embedded-agent/models'
import type { AssistantCliOptions } from './arguments'
import { randomUUID } from 'node:crypto'

/** 使用侧栏的正式服务；会话完成不冒充业务结果验收通过。 */
export async function runEmbeddedCli(options: AssistantCliOptions, context: string,
  write: (record: { type: string; [key: string]: unknown }) => void): Promise<number> {
  if (options.requireVerifiedWrite || options.awaitGeneration) {
    throw new Error('Pi 的业务结果验收尚未接通，不能使用 --require-verified-write 或 --await-generation；不要把回复完成视为写入或生成完成。')
  }
  if (options.printTrace) throw new Error('Pi 使用统一日志中的 embedded_agent 事件；--print-trace 仅适用于 legacy。')
  const model = (await listEmbeddedModels())[0]
  if (!model) throw new Error('请先在设置中配置可用的助手主模型。')
  const service = new EmbeddedAgentService()
  const startedAt = Date.now()
  const runId = randomUUID()
  try {
    if (options.threadId) await service.navigate({ action: 'open', input: options.threadId })
    await service.prompt({ text: options.goal, model, context, access: options.approvalMode === 'full_access' ? 'full' : 'read' }, runId)
    write({ type: 'started', engine: 'pi', runId, access: options.approvalMode === 'full_access' ? 'full' : 'read' })
    while (service.snapshot().busy) {
      if (Date.now() - startedAt >= options.timeoutMs) {
        await service.cancel()
        write({ type: 'finished', engine: 'pi', runId, status: 'timed_out', sessionId: service.snapshot().sessionId, businessVerified: false })
        return 1
      }
      await new Promise<void>(resolve => setTimeout(resolve, 100))
    }
    const snapshot = service.snapshot()
    const failed = Boolean(snapshot.error || snapshot.pendingMessages?.some(message => message.error))
    write({ type: 'finished', engine: 'pi', runId, status: failed ? 'failed' : 'completed', sessionId: snapshot.sessionId,
      durationMs: Date.now() - startedAt, businessVerified: false, error: snapshot.error,
      messages: snapshot.messages })
    return failed ? 1 : 0
  } finally { service.dispose() }
}
