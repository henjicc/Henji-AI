import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITIES } from '../../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentTaskRequiredEffect } from '../../../../../src/core/assistant/taskGraph'
import { potentialEffectMatches } from '../runner/facet-effect-ledger'
import { AgentIntentRouter } from './router'

function snapshot(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-effect-regression',
    revision: 1,
    scopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1, settings: 1 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

function capabilityMatches(required: AgentTaskRequiredEffect, capabilityId: string): boolean {
  return BUILTIN_APPLICATION_CAPABILITIES.find((item) => item.id === capabilityId)
    ?.control.impacts.some((impact) => potentialEffectMatches(required, {
      effect: impact.effect,
      entityTypes: impact.entityTypes,
      propertyIds: impact.propertyIds,
      targetRefs: [], count: 1, verified: false, evidence: [],
    })) ?? false
}

describe('跨领域确定性任务图 Effect 对齐', () => {
  it.each([
    ['查看当前主题设置', 'settings', 'observe', 'get_application_settings'],
    ['把毛玻璃关闭', 'settings', 'update', 'apply_application_settings_change'],
    ['查看 task-abc-123 的进度', 'read_generation', 'observe', 'get_generation_task'],
    ['取消 task-abc-123', 'cancel_generation', 'execute', 'cancel_generation_task'],
    ['生成一张猫的图片', 'generate', 'execute', 'create_visible_generation_task'],
    ['用图片编辑给素材加一个矩形标注', 'image_edit', 'execute', 'create_image_edit_preview_from_ref'],
    ['在画布删除一个节点', 'canvas', 'delete', 'delete_canvas_nodes'],
    ['新建一个画布项目', 'canvas', 'create', 'create_canvas_project'],
  ] as const)('%s 生成可被正式能力承接的 %s Effect', async (goal, intent, effect, capabilityId) => {
    const result = await new AgentIntentRouter(async () => { throw new Error('PROVIDER_ERROR') })
      .route(`run-${intent}`, goal, snapshot(), new AbortController().signal)
    const required = result.taskGraph?.facets
      .flatMap((facet) => facet.requiredEffects)
      .find((candidate) => candidate.effect === effect)
    expect(result.intent).toBe(intent)
    expect(required, `${goal} 缺少 ${effect} Effect`).toBeDefined()
    expect(capabilityMatches(required as AgentTaskRequiredEffect, capabilityId)).toBe(true)
  })

  it('读取设置时拒绝 Router 模型伪造的 update 图并保留确定性 observe 图', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'settings', candidateIntents: ['settings'], toolDomains: ['settings'],
      complexity: 'multi_step', reason: '错误地当成写设置',
      taskFacets: [{
        facetId: 'settings', domain: 'settings', goal: '更新设置',
        targetEntityTypes: ['application.setting'], observationKinds: ['entity_state'],
        capabilityKinds: ['mutate'], targetSurfaceId: null, dependsOn: [], parallelizable: false,
        completionConditions: ['设置已更新'], requiredEffects: [{
          effectId: 'settings_effect', effect: 'update', entityTypes: ['application.setting'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
          actionGroupId: 'settings_actions',
        }], uncertainties: [], confidence: 1,
      }],
    }))
    const result = await router.route(
      'run-settings-baseline',
      '查看当前主题设置并且告诉我是否启用',
      snapshot(),
      new AbortController().signal,
    )
    expect(result.source).toBe('deterministic')
    expect(result.taskGraph?.facets[0]?.requiredEffects[0]?.effect).toBe('observe')
  })
})
