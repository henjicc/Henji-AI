import type { AgentFacetProgress } from '../../../../../src/core/assistant/progress'
import type { AgentTaskFacet } from '../../../../../src/core/assistant/taskGraph'
import { listDependencyFrontierFacets } from '../../../../../src/core/assistant/capabilityDiscovery'
import { digestJson } from '../tools/security'
import { isTerminal, type CallRecord } from './facet-effect-ledger'

export function listActiveFacetIds(facets: AgentTaskFacet[]): string[] {
  return facets.filter((facet) => !isTerminal(facet.status)).map((facet) => facet.facetId)
}

export function listDependencyFrontierFacetIds(
  facets: AgentTaskFacet[],
  limit?: number
): string[] {
  return listDependencyFrontierFacets(facets, limit).map((facet) => facet.facetId)
}

export function buildUserResumeProgress(input: {
  facets: AgentTaskFacet[]
  callRecords: Iterable<CallRecord>
  answer: string
}): AgentFacetProgress[] {
  for (const record of input.callRecords) {
    if (record.succeededWrite) continue
    record.failureCount = 0
    record.noChangeCount = 0
    record.lastErrorCode = null
  }
  const answerDigest = digestJson({ answer: input.answer })
  return input.facets.flatMap((facet) => facet.status === 'waiting_user'
    ? [{
        facetId: facet.facetId,
        status: 'active' as const,
        kind: 'user_input_received' as const,
        summary: '已收到用户补充信息，继续原 Facet。',
        evidence: [`user_input:${answerDigest}`],
        executionFingerprint: answerDigest,
      }]
    : [])
}
