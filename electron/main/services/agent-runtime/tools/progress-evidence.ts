import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ProgressEvidence } from '../../../../../src/core/assistant/progress'
import { digestJson } from './security'

const envelopeFields = new Set([
  'scriptRunRef', 'revision', 'scopeRevisions', 'resultingRevisions', 'snapshotId',
  'rendererSessionId', 'capturedAt', 'observedAt', 'createdAt', 'completedAt',
  'updatedAt', 'reused', 'checkpoint', 'undoRef', 'planRef', 'transactionRef', 'revisions',
])

/** 只去掉工具最外层的传输信封，嵌套的业务属性（包括同名时间字段）全部保留。 */
export function businessResultFingerprint(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return digestJson(output ?? null)
  const record = output as Record<string, unknown>
  if (toolName === 'get_current_application_context') {
    return digestJson({ workspace: record.workspace, surface: record.surface, project: record.project })
  }
  if (toolName === 'discover_application_capabilities') {
    const { fingerprint: _fingerprint, reused: _reused, ...catalog } = record
    return digestJson(catalog)
  }
  return digestJson(Object.fromEntries(Object.entries(record).filter(([key]) => !envelopeFields.has(key))))
}

export function toolProgressEvidence(observation: AgentToolObservation): ProgressEvidence {
  const name = observation.source.toolName
  const record = observation.output && typeof observation.output === 'object' && !Array.isArray(observation.output)
    ? observation.output as Record<string, unknown> : null
  const script = name === 'run_henji_script' || name === 'resume_henji_script'
  const effects = (observation.effects ?? []).map(({ evidence: _evidence, ...effect }) => effect)
  return {
    kind: effects.some((effect) => !['observe', 'navigate'].includes(effect.effect)) ? 'mutation' : 'observation',
    subject: name,
    fingerprint: script
      ? digestJson({ status: record?.status, effects, progress: record?.progressEvidence ?? [], resultRefs: record?.resultRefs ?? [] })
      : businessResultFingerprint(name, observation.output),
  }
}
