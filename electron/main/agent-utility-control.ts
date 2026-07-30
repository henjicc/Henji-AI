import { z } from 'zod'

import type { AgentUtilityCommandAction } from '../../src/core/assistant/utilityContracts'
import { cancelUtilityRun, prepareUtilityShutdown } from './agent-utility-cancellation'
import type { AgentRunner } from './services/agent-runtime/runner/runner'

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
  const approval = z.object({
    runId: z.string().min(1),
    approvalId: z.string().min(1),
    decision: z.enum(['approve', 'reject']),
  }).strict().parse(options.payload)
  return runner.respondApproval(approval.approvalId, approval.decision)
}
