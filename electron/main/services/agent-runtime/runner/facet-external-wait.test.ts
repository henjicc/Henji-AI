import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { createSingleFacetTaskGraph } from '../../../../../src/core/assistant/taskGraph'
import { agentToolObservationSchema } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentFacetProgressTracker } from './facet-progress'

function tool(input: {
  name: string
  readOnly: boolean
  effect: 'execute' | 'observe'
  submitted?: boolean
}) {
  return defineAgentTool({
    name: input.name, version: 1, title: input.name, description: input.name,
    category: 'generation', side: 'backend', risk: 'R0', permission: 'test:generation',
    readOnly: input.readOnly, destructive: false, openWorld: false, idempotent: true,
    timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ taskId: z.string().optional() }).strict(),
    outputSchema: z.record(z.string(), z.unknown()),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    semantics: input.submitted ? { completionKind: 'submitted' } : undefined,
    capability: {
      domain: 'generation', readOnly: input.readOnly,
      control: {
        execution: { mode: 'immediate', cancelable: false, resultState: input.submitted ? 'submitted' : 'observed' },
        impacts: [{
          effect: input.effect, entityTypes: ['generation.task'], propertyIds: [],
          revisionScopes: ['generation'], verificationRequired: !input.readOnly,
        }],
      },
      resolveObservedEffects: input.readOnly
        ? (_toolInput: unknown, output: unknown) => {
            const status = typeof output === 'object' && output
              ? Reflect.get(output, 'status') : undefined
            return [{
              effect: 'observe' as const, entityTypes: ['generation.task'], propertyIds: [],
              targetRefs: [], count: 1, verified: status === 'success', evidence: [],
            }]
          }
        : undefined,
    } as never,
    execute: async () => ({}), concurrencyKey: () => input.name,
    targetIds: () => ({}), dataClasses: () => ['C0'], summarize: () => input.name,
  })
}

function call(toolName: string, taskId?: string): ModelStepToolCall {
  return { toolCallId: `call-${toolName}-${taskId ?? 'new'}`, toolName, input: taskId ? { taskId } : {}, dynamic: false }
}

function observation(toolCall: ModelStepToolCall, output: unknown) {
  return agentToolObservationSchema.parse({
    source: { toolName: toolCall.toolName, toolVersion: 1, toolCallId: toolCall.toolCallId },
    trust: 'untrusted_observation', dataClasses: ['C0'], summary: toolCall.toolName, output,
  })
}

describe('外部长任务 Effect 结算', () => {
  it('submitted Effect 保留在账本中，只在权威终态观察后完成 Facet', () => {
    const registry = new AgentToolRegistry()
    registry.register(tool({ name: 'create_generation', readOnly: false, effect: 'execute', submitted: true }))
    registry.register(tool({ name: 'read_generation', readOnly: true, effect: 'observe' }))
    const tracker = new AgentFacetProgressTracker(createSingleFacetTaskGraph({
      goal: '生成图片', facetId: 'generate', domain: 'generation',
      capabilityKinds: ['observe', 'execute'], effect: 'execute',
      entityTypes: ['generation.task'], verificationRequired: true,
      completionCondition: '生成任务达到权威终态。',
    }), registry)

    const submit = call('create_generation')
    expect(tracker.validate(submit, {})).toBeNull()
    expect(tracker.observe({
      call: submit, observation: observation(submit, { taskId: 'task-1', status: 'submitted' }),
      expectedRevisions: {},
    })[0]).toMatchObject({ status: 'active', kind: 'external_wait_started' })

    const generating = call('read_generation', 'task-1')
    expect(tracker.validate(generating, {})).toBeNull()
    expect(tracker.observe({
      call: generating, observation: observation(generating, { status: 'generating' }),
      expectedRevisions: {},
    })).toEqual([])
    expect(tracker.settlement().status).toBe('active')

    const completed = call('read_generation', 'task-1-completed')
    expect(tracker.observe({
      call: completed, observation: observation(completed, { status: 'success' }),
      expectedRevisions: {},
    })[0]).toMatchObject({ status: 'completed', kind: 'facet_completed' })
  })
})
