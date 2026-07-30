import { z } from 'zod'

import type { AgentUtilityCommandAction } from '../../src/core/assistant/utilityContracts'
import { cancelUtilityRun, prepareUtilityShutdown } from './agent-utility-cancellation'
import type { AgentRunner } from './services/agent-runtime/runner/runner'

interface UtilityRunResources<THostContext> {
  runners: Map<string, AgentRunner>
  hostContexts: Map<string, THostContext>
  activeModelSteps: Map<string, AbortController>
}

export function releaseUtilityRun<THostContext>(
  runId: string,
  resources: UtilityRunResources<THostContext>
): boolean {
  if (!resources.runners.delete(runId)) return false
  resources.hostContexts.delete(runId)
  for (const [requestId, controller] of resources.activeModelSteps) {
    if (!requestId.startsWith(`${runId}:`)) continue
    controller.abort('RUN_SETTLED')
    resources.activeModelSteps.delete(requestId)
  }
  return true
}

export function releaseUtilityRunPayload<THostContext>(
  payload: unknown,
  resources: UtilityRunResources<THostContext>
): { released: true } {
  const parsed = z.object({ runId: z.string().min(1) }).strict().parse(payload)
  if (!releaseUtilityRun(parsed.runId, resources)) {
    throw new Error(`[run_not_found] 运行不存在：${parsed.runId}`)
  }
  return { released: true }
}

interface ExecuteUtilityControlOptions {
  action: Exclude<AgentUtilityCommandAction, 'run.start'>
  payload: unknown
  requireRunner: (runId: string) => AgentRunner
  runners: Iterable<AgentRunner>
}

export async function executeUtilityControlCommand(
  options: ExecuteUtilityControlOptions
): Promise<unknown> {
  if (options.action === 'process.shutdown') {
    await prepareUtilityShutdown(options.runners)
    setTimeout(() => process.exit(0), 20).unref()
    return { shuttingDown: true }
  }
  const base = z.object({ runId: z.string().min(1) }).passthrough().parse(options.payload)
  const runner = options.requireRunner(base.runId)
  if (options.action === 'run.pause') return runner.pause()
  if (options.action === 'run.resume') return runner.resume()
  if (options.action === 'run.cancel') {
    const parsed = z.object({
      runId: z.string().min(1),
      reason: z.string().min(1).max(500),
    }).strict().parse(options.payload)
    return await cancelUtilityRun(runner, parsed.reason)
  }
  if (options.action === 'run.clarification') {
    const parsed = z.object({
      runId: z.string().min(1),
      waitId: z.string().min(1),
      content: z.string().trim().min(1).max(32 * 1024),
    }).strict().parse(options.payload)
    return runner.respondClarification(parsed.waitId, parsed.content)
  }
  const approval = z.object({
    runId: z.string().min(1),
    approvalId: z.string().min(1),
    decision: z.enum(['approve', 'reject']),
  }).strict().parse(options.payload)
  return runner.respondApproval(approval.approvalId, approval.decision)
}
