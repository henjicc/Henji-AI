import { describe, expect, it } from 'vitest'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentRuntimeModelSet } from './models'
import { buildAgentTurnSnapshotDraft } from './turn-snapshot'

describe('turn snapshot', () => {
  it('冻结模型、工具与 revision 且不含凭据', () => {
    const model = {
      providerId: 'provider', modelId: 'model', adapter: 'openai-compatible',
      capabilities: { streaming: true, toolCall: true, parallelTools: false, structuredOutputMode: 'json', reasoning: false, sampling: true, usage: true },
      limits: { contextWindow: 32_000, contextWindowSource: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000 },
    } as const
    const models: AgentRuntimeModelSet = { primary: model, router: model, summarizer: model, fellBack: false }
    const host = {
      scopeRevisions: { navigation: 1, generation: 2, canvas: 3, toolbox: 4, assets: 5 },
    } as HostContextSnapshot
    const snapshot = buildAgentTurnSnapshotDraft({
      runId: 'run', threadId: 'thread', turn: 1, host, models,
      registrations: [{
        catalog: { name: 'tool', version: 2 },
        modelTool: { name: 'tool', description: 'test', inputSchema: { type: 'object' } },
      } as never],
      artifactRefs: ['artifact:1'], approvalMode: 'ask',
    })
    expect(snapshot.tools[0]).toMatchObject({ name: 'tool', version: 2 })
    expect(snapshot.tools[0]?.schemaDigest).toHaveLength(64)
    expect(snapshot.scopeRevisions).toEqual(host.scopeRevisions)
    expect(JSON.stringify(snapshot)).not.toMatch(/api.?key|authorization/i)
  })
})
