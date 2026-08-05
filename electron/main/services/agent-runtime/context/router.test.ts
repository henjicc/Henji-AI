import { describe, expect, it, vi } from 'vitest'

import { contextSnapshot } from './context-test-fixtures'
import { AgentIntentRouter } from './router'

describe('AgentIntentRouter', () => {
  it('明确导航请求不调用 router 模型', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-1', '切换到素材库工作区', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'navigate', source: 'deterministic', path: 'workflow' })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('询问助手整体能力时直接回答，不调用路由模型或能力搜索', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-capability-overview', '你能做啥', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'general',
      source: 'deterministic',
      complexity: 'simple',
      path: 'primary',
      toolDomains: [],
    })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('router 失败时保守进入 primary', async () => {
    const router = new AgentIntentRouter(async () => { throw new Error('offline') })
    const result = await router.route(
      'run-1', '帮我处理一下这个需求', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'general', source: 'fallback', path: 'primary' })
  })

  it('明显的画布与定位组合请求拒绝缺少验证的模型图并回退完整确定性图', async () => {
    const classifier = vi.fn().mockResolvedValue({
      intent: 'canvas',
      candidateIntents: ['canvas', 'navigate'],
      toolDomains: ['canvas', 'navigation'],
      complexity: 'multi_step',
      reason: '用户要求编排多个画布节点',
      taskFacets: [{
        facetId: 'canvas_structure', domain: 'canvas', goal: '创建两个画布节点并连接',
        targetEntityTypes: ['canvas.node', 'canvas.edge'], observationKinds: ['entity_state'],
        capabilityKinds: ['observe', 'mutate'], targetSurfaceId: 'workspace.canvas', dependsOn: [],
        parallelizable: false, completionConditions: ['两个节点都存在且结构已验证'],
        requiredEffects: [{
          effectId: 'create_two_nodes', effect: 'create', entityTypes: ['canvas.node'],
          propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: true,
          actionGroupId: 'canvas_structure_actions',
        }], uncertainties: [], confidence: 0.98,
      }, {
        facetId: 'show_target_surface', domain: 'navigation', goal: '打开画布',
        targetEntityTypes: [], observationKinds: ['current_surface'], capabilityKinds: ['navigate'],
        targetSurfaceId: 'workspace.canvas', dependsOn: ['canvas_structure'], parallelizable: false,
        completionConditions: ['画布界面已打开'], requiredEffects: [{
          effectId: 'show_canvas', effect: 'navigate', entityTypes: [], propertyIds: [], minimumCount: 1,
          targetRefs: [], verificationRequired: false, actionGroupId: 'show_canvas_actions',
        }], uncertainties: [], confidence: 0.95,
      }],
    })
    const result = await new AgentIntentRouter(classifier).route(
      'run-canvas',
      '在画布添加两个节点，连接并定位生成节点',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      routeVersion: 'agent-route/v2',
      intent: 'canvas',
      source: 'deterministic',
      toolDomains: ['canvas', 'navigation', 'catalog'],
    })
    expect(result.taskGraph?.facets.map((facet) => facet.facetId)).toEqual([
      'canvas_structure', 'canvas_verify', 'show_target_surface',
    ])
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'canvas_structure')?.requiredEffects[0])
      .toMatchObject({ effect: 'create', entityTypes: ['canvas.node'], minimumCount: 2 })
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'canvas_verify'))
      .toMatchObject({ capabilityKinds: ['observe', 'query'], dependsOn: ['canvas_structure'] })
    expect(classifier).toHaveBeenCalledOnce()
  })

  it('三维工程、场景、运镜和展示请求一次拆出有依赖的完整任务图', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-camera-composite',
      '创建一个三维工程，摆放立方体和棱锥，再做环绕运镜并打开三维工具让我看到',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'camera_stage',
      complexity: 'multi_step',
      source: 'deterministic',
    })
    expect(result.toolDomains).toEqual(expect.arrayContaining([
      'toolbox', 'camera_stage', 'navigation', 'catalog',
    ]))
    expect(result.taskGraph?.facets.map((facet) => facet.facetId)).toEqual([
      'camera_project', 'show_target_surface', 'camera_scene', 'camera_motion', 'camera_verify',
    ])
    expect(result.taskGraph?.dependencies).toEqual(expect.arrayContaining([
      { fromFacetId: 'camera_project', toFacetId: 'show_target_surface' },
      { fromFacetId: 'show_target_surface', toFacetId: 'camera_scene' },
      { fromFacetId: 'camera_scene', toFacetId: 'camera_motion' },
      { fromFacetId: 'camera_motion', toFacetId: 'camera_verify' },
    ]))
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'camera_verify'))
      .toMatchObject({ capabilityKinds: ['observe'], targetSurfaceId: 'tool.camera_stage' })
    expect(result.taskGraph?.facets.find((facet) => facet.facetId === 'show_target_surface'))
      .toMatchObject({ targetSurfaceId: 'tool.camera_stage', parallelizable: false })
    expect(classifier).toHaveBeenCalledOnce()
  })

  it('模型路由 Facet 经过本地领域白名单校验后形成可持久任务图', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'workflow',
      candidateIntents: ['assets'],
      toolDomains: ['workflows', 'assets'],
      complexity: 'multi_step',
      reason: '先选择素材，再运行工作流',
      taskFacets: [{
        facetId: 'select_asset',
        domain: 'assets',
        goal: '读取并选择目标素材',
        targetEntityTypes: ['asset'],
        observationKinds: ['entity_state', 'entity_schema'],
        capabilityKinds: ['observe', 'query'],
        targetSurfaceId: 'workspace.assets',
        dependsOn: [],
        parallelizable: false,
        completionConditions: ['取得素材稳定引用'],
        requiredEffects: [{
          effectId: 'select_asset_effect', effect: 'observe', entityTypes: ['asset'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
          actionGroupId: 'select_asset_actions',
        }],
        uncertainties: [],
        confidence: 0.9,
      }, {
        facetId: 'run_workflow',
        domain: 'workflows',
        goal: '使用素材引用运行工作流',
        targetEntityTypes: ['workflow.run'],
        observationKinds: ['operation_schema'],
        capabilityKinds: ['plan', 'execute'],
        targetSurfaceId: null,
        dependsOn: ['select_asset'],
        parallelizable: false,
        completionConditions: ['工作流进入已提交或完成状态'],
        requiredEffects: [{
          effectId: 'run_workflow_effect', effect: 'execute', entityTypes: ['workflow.run'],
          propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
          actionGroupId: 'run_workflow_actions',
        }],
        uncertainties: [],
        confidence: 0.85,
      }],
    }))
    const result = await router.route(
      'run-model-facets', '把合适素材用于已有流程', contextSnapshot(), new AbortController().signal
    )
    expect(result.taskGraph).toMatchObject({
      version: 'agent-task-graph/v2',
      facets: [
        expect.objectContaining({ facetId: 'select_asset', domain: 'assets' }),
        expect.objectContaining({ facetId: 'run_workflow', dependsOn: ['select_asset'] }),
      ],
    })
  })

  it('自然语言长期偏好请求由模型理解语义，本地策略决定工具域和正式 Effect', async () => {
    const classifier = vi.fn().mockResolvedValue({
      intent: 'user_instructions',
      complexity: 'simple',
      reason: '用户要求长期保存供应商偏好',
    })
    const result = await new AgentIntentRouter(classifier).route(
      'run-preferences',
      '记住我优先使用 PPIO 供应商的模型',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'user_instructions',
      source: 'router_model',
      toolDomains: ['user_instructions'],
    })
    expect(result.taskGraph?.facets[0]?.requiredEffects[0]).toMatchObject({
      effect: 'update', entityTypes: ['assistant.user_instructions'], minimumCount: 1,
    })
    expect(classifier).toHaveBeenCalledOnce()
  })

  it('简单一般回答没有伪造的工具 Effect，不会被空 Task Graph 阻止收口', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'general', complexity: 'simple', reason: '无需调用工具即可回答',
    }))
    const result = await router.route(
      'run-simple-general', '解释一下什么是景深', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'general', complexity: 'simple' })
    expect(result.taskGraph).toBeUndefined()
  })

  it('明确媒体生成请求直接进入完整确定性生成工具链', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-photo',
      '生成一张剪纸风格的猫咪的那种照片',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'generate',
      source: 'deterministic',
      path: 'workflow',
      toolDomains: ['models', 'generation', 'navigation'],
    })
    expect(result.taskGraph?.facets[0]?.requiredEffects[0]).toMatchObject({
      effect: 'execute', entityTypes: ['generation.task'], verificationRequired: true,
    })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('路由模型附属字段变形时保留已校验的主意图并回退本地工具域策略', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      candidateIntents: [],
      toolDomains: { workspace: 'generation', mediaType: 'image' },
      complexity: 'simple',
      reason: '用户请求创建图片生成任务',
    }))
    const result = await router.route(
      'run-malformed-router-output', '创建一张图片', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'generate',
      source: 'router_model',
      complexity: 'simple',
      toolDomains: ['models', 'generation', 'navigation'],
    })
  })

  it('router 候选只能扩展本地允许的工具域且不能改写执行路径', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      candidateIntents: ['assets'],
      complexity: 'simple',
      path: 'primary',
      toolDomains: ['catalog', 'assets'],
      reason: '用户希望生成照片',
    }))
    const result = await router.route(
      'run-router-policy', '帮我完成这个视觉需求', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'generate',
      source: 'router_model',
      path: 'workflow',
      candidateIntents: ['generate', 'assets'],
      toolDomains: ['models', 'generation', 'navigation', 'assets', 'catalog'],
    })
  })
})
