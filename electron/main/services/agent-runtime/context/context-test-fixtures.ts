import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AssistantSkillMetadata } from '../../../../../src/core/assistant/skills'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentContextBuildInput } from './types'

export function contextSnapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-1',
    revision: 4,
    scopeRevisions: { navigation: 1, generation: 2, canvas: 1, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: 'project-1', selectedNodeId: null },
    generation: {
      commandReady: true,
      modelCatalog: {
        catalogVersion: 'model-registry/v1',
        modelGroups: [{
          canonicalModelId: 'test-image', mediaType: 'image',
          name: '测试图片模型', description: '推荐使用！', tags: ['text-to-image'],
          recommendedByDescription: true,
          providers: [{ providerId: 'test', modelId: 'test-image', priceEstimate: { amount: 0.01, currency: 'CNY' } }],
        }],
      },
    },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [
      'switch_workspace',
      'create_visible_generation_task',
      'get_host_context',
      'search_models',
    ],
    capturedAt: new Date().toISOString(),
  }
}

export function skillMetadata(
  name: string,
  description: string,
  enabled = true
): AssistantSkillMetadata {
  return {
    name,
    description,
    source: 'builtin',
    overridesBuiltin: false,
    enabled,
    bodyBytes: 128,
    referencePaths: [],
    updatedAt: new Date().toISOString(),
  }
}

export function skillBuildInput(skills: AssistantSkillMetadata[] | undefined): AgentContextBuildInput {
  return {
    runId: 'run-skills-index',
    goal: '生成一张图片',
    skills,
    snapshot: contextSnapshot(),
    route: {
      intent: 'generate', complexity: 'simple',toolDomains: ['generation'],
      explicitUserIntent: true,
     reason: '技能索引测试',
    },
    conversation: [],
    observations: [],
    modelTools: [],
    activeToolNames: [],
    contextWindowBudget: 16_000,
  }
}

export function observation(output: unknown): AgentToolObservation {
  return {
    source: { toolName: 'query_diagnostic_events', toolVersion: 1, toolCallId: 'tool-1' },
    trust: 'untrusted_observation',
    dataClasses: ['C2'],
    summary: '发现一条错误证据',
    output,
  }
}

