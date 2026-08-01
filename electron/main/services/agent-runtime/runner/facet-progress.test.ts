import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { agentToolObservationSchema, type AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { agentTaskGraphSchema, type AgentTaskFacet } from '../../../../../src/core/assistant/taskGraph'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentFacetProgressTracker } from './facet-progress'

const schemaDigest = `sha256:${'a'.repeat(64)}`

function facet(input: Partial<AgentTaskFacet> & Pick<AgentTaskFacet, 'facetId' | 'domain'>): AgentTaskFacet {
  return {
    facetId: input.facetId,
    domain: input.domain,
    goal: input.goal ?? `完成 ${input.facetId}`,
    targetEntityTypes: input.targetEntityTypes ?? [],
    requiredObservations: input.requiredObservations ?? [],
    capabilityKinds: input.capabilityKinds ?? ['mutate'],
    targetSurfaceId: input.targetSurfaceId ?? null,
    dependsOn: input.dependsOn ?? [],
    parallelizable: input.parallelizable ?? false,
    completionConditions: input.completionConditions ?? ['返回稳定 revision 或引用'],
    uncertainties: input.uncertainties ?? [],
    confidence: input.confidence ?? 1,
    status: input.status ?? 'pending',
    statusReason: input.statusReason ?? '',
    evidence: input.evidence ?? [],
  }
}

function graph(facets: AgentTaskFacet[]) {
  return agentTaskGraphSchema.parse({
    version: 'agent-task-graph/v1',
    goal: '测试结构化进展',
    facets,
    dependencies: facets.flatMap((item) => item.dependsOn.map((dependency) => ({
      fromFacetId: dependency,
      toFacetId: item.facetId,
    }))),
    stopConditions: ['完成或明确受阻时停止。'],
  })
}

function call(toolName: string, input: Record<string, unknown> = { id: 'same' }): ModelStepToolCall {
  return { toolCallId: `call-${toolName}`, toolName, input, dynamic: false }
}

function observation(toolName: string, output: unknown): AgentToolObservation {
  return agentToolObservationSchema.parse({
    source: { toolName, toolVersion: 1, toolCallId: `call-${toolName}` },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: `${toolName} 结果`,
    output,
  })
}

function failure(toolName: string, code: string, recovery = 'none'): AgentToolObservation {
  return observation(toolName, {
    ok: false,
    error: { code, message: `${code} 测试失败`, retryable: false, recovery },
  })
}

function registry(): AgentToolRegistry {
  const result = new AgentToolRegistry()
  for (const definition of [
    { name: 'write_camera', category: 'camera_stage', readOnly: false },
    { name: 'read_camera', category: 'camera_stage', readOnly: true },
  ]) {
    result.register(defineAgentTool({
      ...definition,
      version: 1,
      title: definition.name,
      description: '测试进展判定。',
      side: 'backend',
      risk: 'R0',
      permission: 'test:progress',
      destructive: false,
      openWorld: false,
      idempotent: true,
      timeoutMs: 1_000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false,
      supportsUndo: false,
      requiredContext: [],
      inputSchema: z.object({ id: z.string() }).strict(),
      outputSchema: z.record(z.string(), z.unknown()),
      aiInputSchema: {
        type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
      },
      execute: async () => ({}),
      concurrencyKey: (input) => `${definition.name}:${input.id}`,
      targetIds: (input) => ({ id: input.id }),
      dataClasses: () => ['C0'],
      summarize: () => '完成',
    }))
  }
  return result
}

describe('AgentFacetProgressTracker', () => {
  it('能力缺失会阻塞目标 Facet 及其依赖项并立即结算', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
      facet({ facetId: 'navigate', domain: 'navigation', dependsOn: ['camera'] }),
      facet({ facetId: 'verify', domain: 'diagnostics', dependsOn: ['navigate'] }),
    ]), registry())

    const events = tracker.observe({
      call: call('discover_application_capabilities', { facets: ['camera'] }),
      expectedRevisions: {},
      observation: observation('discover_application_capabilities', {
        fingerprint: schemaDigest,
        reused: false,
        facets: [],
        missing: [{ facetId: 'camera', reason: 'unsupported_domain' }],
      }),
    })

    expect(events).toEqual([expect.objectContaining({
      facetId: 'camera', status: 'blocked', kind: 'capability_missing',
    })])
    expect(tracker.drainPendingEvents()).toEqual([
      expect.objectContaining({ facetId: 'navigate', status: 'blocked' }),
      expect.objectContaining({ facetId: 'verify', status: 'blocked' }),
    ])
    expect(tracker.settlement()).toMatchObject({
      status: 'blocked', remainingFacetIds: [],
    })
  })

  it('新 schema 算进展，缓存发现不产生新 schema 时停止重复搜索', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    const discoveryCall = call('discover_application_capabilities', { facets: ['camera'] })
    const discoveryOutput = {
      fingerprint: schemaDigest,
      reused: false,
      missing: [],
      facets: [{
        facetId: 'camera',
        schemaRefs: [{
          catalogVersion: 'application-capabilities/v2', kind: 'operation', id: 'write_camera',
          version: 1, digest: schemaDigest,
        }],
      }],
    }
    expect(tracker.observe({
      call: discoveryCall, expectedRevisions: {},
      observation: observation(discoveryCall.toolName, discoveryOutput),
    })[0]).toMatchObject({ kind: 'schema_discovered', status: 'active' })

    const stopped = tracker.observe({
      call: discoveryCall, expectedRevisions: {},
      observation: observation(discoveryCall.toolName, { ...discoveryOutput, reused: true }),
    })
    expect(stopped[0]).toMatchObject({ kind: 'repeated_discovery', status: 'blocked' })
    expect(tracker.settlement().status).toBe('blocked')
  })

  it('成功写入后阻止相同参数和 base revision 的重复创建并保留部分完成', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'first_object', domain: 'camera_stage' }),
      facet({ facetId: 'second_object', domain: 'camera_stage' }),
    ]), registry())
    const write = call('write_camera')
    tracker.observe({
      call: write,
      expectedRevisions: { toolbox: 4 },
      observation: observation(write.toolName, { objectId: 'object-1', revision: 5 }),
    })

    const decision = tracker.validate(write, { toolbox: 4 })
    expect(decision).toMatchObject({
      events: [{ kind: 'repeated_write', status: 'blocked' }],
    })
    expect(tracker.settlement()).toMatchObject({
      status: 'partial', completedFacetIds: ['first_object'],
      blockedFacets: [{ facetId: 'second_object' }],
    })
    expect(tracker.settlementGuidance()).toContain('已完成部分')
  })

  it('revision 冲突后在未重读状态前拒绝相同 base revision 重试', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    const write = call('write_camera')
    tracker.observe({
      call: write,
      expectedRevisions: { toolbox: 4 },
      observation: failure(write.toolName, 'CONFLICT', 'refresh_context'),
    })

    expect(tracker.validate(write, { toolbox: 4 })).toMatchObject({
      events: [{ kind: 'revision_conflict', status: 'blocked' }],
    })
  })

  it('无效输入重复且明确需要用户动作时复用 waiting_user 结算', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
      facet({ facetId: 'verify', domain: 'diagnostics', dependsOn: ['camera'] }),
    ]), registry())
    const write = call('write_camera')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      tracker.observe({
        call: write,
        expectedRevisions: { toolbox: 4 },
        observation: failure(write.toolName, 'INVALID_INPUT', 'user_action'),
      })
    }

    expect(tracker.settlement()).toMatchObject({
      status: 'waiting_user', waitingFacetIds: ['camera'], remainingFacetIds: ['verify'],
    })
    expect(tracker.settlementGuidance()).toContain('最小具体问题')

    expect(tracker.resumeWaitingFacets('project-1 的 object-1')).toEqual([
      expect.objectContaining({
        facetId: 'camera', status: 'active', kind: 'user_input_received',
      }),
    ])
    expect(tracker.settlement().status).toBe('active')
    expect(tracker.validate(write, { toolbox: 4 })).toBeNull()
  })

  it('权限拒绝不会继续尝试同一 Facet', () => {
    const tracker = new AgentFacetProgressTracker(graph([
      facet({ facetId: 'camera', domain: 'camera_stage' }),
    ]), registry())
    tracker.observe({
      call: call('write_camera'), expectedRevisions: {},
      observation: failure('write_camera', 'PERMISSION_DENIED', 'user_action'),
    })
    expect(tracker.settlement()).toMatchObject({
      status: 'blocked', blockedFacets: [{ facetId: 'camera' }],
    })
  })
})
