import { describe, expect, it, vi } from 'vitest'

import { contextSnapshot } from './context-test-fixtures'
import { decideToolAuthorization } from '../tools/approval-policy'
import { AgentIntentRouter } from './router'

describe('AgentIntentRouter', () => {
  it('明确导航请求不调用 router 模型', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-1', '切换到素材库工作区', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'navigate', explicitUserIntent: true })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('设置里的临时切换与恢复统一建模为两次 update，不被“恢复”误判成 execute', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-settings-restore',
      '读取当前界面主题色调，把它临时切换到另一个合法值，验证后恢复原值并再次验证',
      contextSnapshot(),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ intent: 'settings', explicitUserIntent: true })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('直接使用稳定设置 ID 时无需路由模型也能进入设置写入与恢复任务', async () => {
    const classifier = vi.fn(() => Promise.reject(new Error('router unavailable')))
    const result = await new AgentIntentRouter(classifier).route(
      'run-settings-ids',
      '先读取 general.language 与 interface.theme_tone 的当前真实值；用一次 Henji Script 修改并读回验证，随后仍在同一脚本中恢复原值并再次读回验证。',
      contextSnapshot(),
      new AbortController().signal,
    )

    expect(result).toMatchObject({ intent: 'settings', explicitUserIntent: true })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('询问助手整体能力时直接回答，不调用路由模型或能力搜索', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-capability-overview', '你能做啥', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'general',
      explicitUserIntent: false,
      toolDomains: [],
    })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('router 失败时保守进入 primary', async () => {
    const router = new AgentIntentRouter(async () => { throw new Error('offline') })
    const result = await router.route(
      'run-1', '帮我处理一下这个需求', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'general', explicitUserIntent: false })
  })

  /*
   * 授权门禁：explicitUserIntent 是权限位，不是分类标签。
   *
   * 它唯一的消费方是 approval-policy —— assistant_decides 模式下只有它为真才自动放行 R1
   * 非只读非破坏性工具。以前这个语义靠 `intent !== 'general'` 现场推断，intent 取值一演化
   * 就会静默改变每次运行的授权范围。这里把「路由没识别出任务 → 不自动放行写工具」钉死。
   */
  it('路由没识别出具体任务时不发放写工具自动放行位', async () => {
    const failed = await new AgentIntentRouter(async () => { throw new Error('offline') }).route(
      'run-auth-fallback', '帮我处理一下这个需求', contextSnapshot(), new AbortController().signal
    )
    expect(failed.explicitUserIntent).toBe(false)
    expect(decideToolAuthorization({
      mode: 'assistant_decides', risk: 'R1', readOnly: false, destructive: false,
      dataClasses: ['C1'], explicitUserIntent: failed.explicitUserIntent,
    })).toBe('approval_required')

    const overview = await new AgentIntentRouter(async () => {
      throw new Error('不应调用分类器')
    }).route('run-auth-overview', '你能做什么', contextSnapshot(), new AbortController().signal)
    expect(overview.explicitUserIntent).toBe(false)
  })

  it('识别出具体应用任务时才自动放行 R1 写工具', async () => {
    const result = await new AgentIntentRouter(async () => {
      throw new Error('不应调用分类器')
    }).route(
      'run-auth-settings', '把界面主题改成深色', contextSnapshot(), new AbortController().signal
    )
    expect(result.explicitUserIntent).toBe(true)
    expect(decideToolAuthorization({
      mode: 'assistant_decides', risk: 'R1', readOnly: false, destructive: false,
      dataClasses: ['C1'], explicitUserIntent: result.explicitUserIntent,
    })).toBe('auto_allowed')
  })

  it('明显的画布与定位组合请求走确定性规则，不调用路由模型', async () => {
    const classifier = vi.fn().mockResolvedValue({
      intent: 'canvas',
      candidateIntents: ['canvas', 'navigate'],
      toolDomains: ['canvas', 'navigation'],
      reason: '用户要求编排多个画布节点',
      explicitUserIntent: true,
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
      intent: 'canvas',
      explicitUserIntent: true,
      toolDomains: ['canvas', 'navigation'],
    })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('三维工程、场景、运镜和展示请求落在三维领域，并带上导航锚点', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-camera-composite',
      '创建一个三维工程，摆放立方体和棱锥，再做环绕运镜并打开三维工具让我看到',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'camera_stage',
      explicitUserIntent: true,
    })
    expect(result.toolDomains).toEqual(expect.arrayContaining([
      'toolbox', 'camera_stage', 'navigation',
    ]))
    expect(classifier).not.toHaveBeenCalled()
  })

  it('自然语言长期偏好请求由模型理解语义，本地策略决定工具域和正式 Effect', async () => {
    const classifier = vi.fn().mockResolvedValue({
      intent: 'user_instructions',
      reason: '用户要求长期保存供应商偏好',
      explicitUserIntent: true,
    })
    const result = await new AgentIntentRouter(classifier).route(
      'run-preferences',
      '记住我优先使用 PPIO 供应商的模型',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'user_instructions',
      explicitUserIntent: true,
      toolDomains: ['user_instructions'],
    })
    expect(classifier).toHaveBeenCalledOnce()
  })

  it('简单一般回答没有伪造的工具 Effect，不会被空 Task Graph 阻止收口', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'general', reason: '无需调用工具即可回答',
    }))
    const result = await router.route(
      'run-simple-general', '解释一下什么是景深', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'general', explicitUserIntent: false })
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
      explicitUserIntent: true,
      toolDomains: ['models', 'generation', 'navigation'],
    })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('生成目标同时提到选择可用模型时仍以生成写入为主动作', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-photo-with-model',
      '生成一张蓝色玻璃球图片，选择当前可用的图片模型并等待完成',
      contextSnapshot(),
      new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'generate', explicitUserIntent: true })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('生成后确认进入历史仍是生成任务，不被“生成历史”反向覆盖', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-generate-history',
      '生成一张西湖图片，等待完成并确认结果已经进入正式生成历史',
      contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'generate', explicitUserIntent: true })
    expect(classifier).not.toHaveBeenCalled()
  })

  it('创建素材库直接进入素材领域，不回退到澄清任务', async () => {
    const classifier = vi.fn()
    const result = await new AgentIntentRouter(classifier).route(
      'run-create-library', '创建一个名为真实验收的素材库',
      contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'assets',toolDomains: expect.arrayContaining(['assets']),
      explicitUserIntent: true,
    })
    expect(classifier).not.toHaveBeenCalled()

    const collection = await new AgentIntentRouter(classifier).route(
      'run-create-collection', '创建素材集合：在 asset.catalog:default 下新增一项 asset.library',
      contextSnapshot(), new AbortController().signal
    )
    expect(collection).toMatchObject({ intent: 'assets', explicitUserIntent: true })
  })

  /*
   * 这条曾经断言"预先声明两次写入"——路由要在动手前数出用户会改几个值。数错就永远结算不了，
   * 而数量的唯一权威是脚本解释器的逐属性读回。任务图删除后路由只判领域，这里也只断言领域。
   */
  it('设置切换后恢复原值仍然落在设置领域，不被“恢复”带偏', async () => {
    const result = await new AgentIntentRouter().route(
      'run-settings-restore',
      '把主题切换为另一个合法值，读回后恢复原值并再次确认',
      contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({ intent: 'settings', explicitUserIntent: true })
    expect(result.toolDomains).toEqual(expect.arrayContaining(['settings']))
  })

  it('路由模型附属字段变形时保留已校验的主意图并回退本地工具域策略', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      candidateIntents: [],
      toolDomains: { workspace: 'generation', mediaType: 'image' },
      reason: '用户请求创建图片生成任务',
      explicitUserIntent: true,
    }))
    const result = await router.route(
      'run-malformed-router-output', '创建一张图片', contextSnapshot(), new AbortController().signal
    )
    expect(result).toMatchObject({
      intent: 'generate',
      explicitUserIntent: true,
      toolDomains: ['models', 'generation', 'navigation'],
    })
  })

  it('router 候选只能扩展本地允许的工具域且不能改写执行路径', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      candidateIntents: ['assets'],
      toolDomains: ['catalog', 'assets'],
      reason: '用户希望生成照片',
      explicitUserIntent: true,
    }))
    const result = await router.route(
      'run-router-policy', '帮我完成这个视觉需求', contextSnapshot(), new AbortController().signal
    )
    // candidateIntents 已删（零消费方）；模型能否越权只看最终 toolDomains 是不是本地白名单推导的。
    expect(result).toMatchObject({
      intent: 'generate',
      explicitUserIntent: true,
      toolDomains: ['models', 'generation', 'navigation', 'assets', 'catalog'],
    })
  })
})




