// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { ApplicationOperationImpact } from '@/core/application-control'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { ASSET_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/assetApplicationCapabilities'
import { CAMERA_STAGE_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/cameraStageApplicationCapabilities'
import { CANVAS_BATCH_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'
import { CANVAS_MUTATION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasMutationApplicationCapabilities'
import { CANVAS_PROJECT_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/canvasProjectApplicationCapabilities'
import { GENERATION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/generationApplicationCapabilities'
import { TOOLBOX_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/toolboxApplicationCapabilities'
import { agentObservedEffectSchema } from '@/core/assistant/observedEffect'

import { listRendererApplicationCapabilityIds } from './registry'

describe('application capability handler coverage', () => {
  it('每项内建前端能力都有唯一处理器', () => {
    const definitionIds = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
      .list()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.id)
      .sort()
    const handlerIds = listRendererApplicationCapabilityIds().sort()

    expect(handlerIds).toEqual(definitionIds)
    expect(new Set(handlerIds).size).toBe(handlerIds.length)
  })

  it('旧前端工具已经全部成为原生能力定义', () => {
    const migrated = [
      ...GENERATION_APPLICATION_CAPABILITIES,
      ...ASSET_APPLICATION_CAPABILITIES,
      ...CANVAS_PROJECT_APPLICATION_CAPABILITIES,
      ...CANVAS_MUTATION_APPLICATION_CAPABILITIES,
      ...CANVAS_BATCH_APPLICATION_CAPABILITIES,
      ...CAMERA_STAGE_APPLICATION_CAPABILITIES,
      ...TOOLBOX_APPLICATION_CAPABILITIES,
    ]
    expect(new Set(migrated.map((definition) => definition.id)).size).toBe(migrated.length)
    for (const definition of migrated) {
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(definition.id)).toBe(definition)
      expect(definition.permission).not.toBe('')
      expect(definition.successEvidence.length).toBeGreaterThan(0)
      expect(definition.failureRecovery.length).toBeGreaterThan(0)
    }
  })

  it('创建能力保持后台原子性，打开能力声明可验证 Surface', () => {
    const createCamera = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('create_camera_stage_project')
    expect(createCamera?.requiredScopes).not.toContain('navigation')
    expect(createCamera?.producesRefs).not.toContain('application.surface')
    expect(createCamera?.description).toContain('不切换当前界面')
    expect(createCamera?.version).toBe(4)
    expect(createCamera?.inputSchema.safeParse({ name: '单一状态关键帧工程' }).success).toBe(true)
    expect(createCamera?.inputSchema.safeParse({ name: '旧输入', mode: 'pro' }).success).toBe(false)
    expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('bake_camera_stage_to_pro')).toBeUndefined()

    for (const id of ['open_camera_stage_project', 'open_canvas_project', 'focus_canvas_node']) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
      expect(definition?.requiredScopes).toContain('navigation')
      expect(definition?.producesRefs).toContain('application.surface')
      expect(definition?.successEvidence.join(' ')).toMatch(/tool\.camera_stage|workspace\.canvas/)
    }
  })

  /**
   * 门禁：**名字说自己会增/删/跳转的能力，impacts 里必须真的有那条 effect。**
   *
   * 声明漏一条 effect，代价有两处，而且两处都不报错、只是"没反应"：
   * 1. Facet 结算按 effect 对账——模型明明干完了活，任务图停在"未结算"，只能反复重试；
   * 2. 发现层的排序按 effect 走——真正该用的能力排到无关能力后面。
   *
   * 实测已经吃过两次：place_camera_stage_object 只声明 execute（当时还是硬过滤，直接消失），
   * create_visible_generation_task 同样只声明 execute。名字里的动词是最便宜的交叉验证，
   * 免费拿来当门禁。
   */
  it('名字里的动词与 impacts 声明的 effect 一致', () => {
    /*
     * 例外必须逐条写明理由，不接受"名字只是名字"。
     * 这两条是**属性写入**而不是集合增删：素材的库归属存在 asset.library_refs 上，
     * 走 append/remove 两个 operation，实体本身既没新建也没删除，声明 update 是准确的。
     */
    const justifiedExceptions = new Set(['add_asset_to_library', 'remove_asset_from_library'])
    const rules: { pattern: RegExp; effect: ApplicationOperationImpact['effect'] }[] = [
      { pattern: /^(?:create|add|new|duplicate)_/, effect: 'create' },
      { pattern: /^(?:delete|remove)_/, effect: 'delete' },
      { pattern: /^(?:open|show|switch|focus)_/, effect: 'navigate' },
    ]

    const mismatched: string[] = []
    for (const definition of BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()) {
      if (justifiedExceptions.has(definition.id)) continue
      const effects = new Set(definition.control.impacts.map((impact) => impact.effect))
      for (const rule of rules) {
        if (!rule.pattern.test(definition.id)) continue
        if (effects.has(rule.effect)) continue
        mismatched.push(`${definition.id}（名字暗示 ${rule.effect}，实际只声明 ${[...effects].join('+')}）`)
      }
    }

    expect(mismatched, [
      '以下能力的名字与 impacts 对不上。要么补 alsoImpacts 把真正产生的 effect 声明全，',
      '要么改名；确实是例外就写进 justifiedExceptions 并说明为什么：',
      ...mismatched,
    ].join('\n')).toEqual([])
  })

  it('所有声明产生应用 Surface 的能力都绑定导航作用域和界面成功证据', () => {
    const surfaceCapabilities = BUILTIN_APPLICATION_CAPABILITY_REGISTRY
      .list()
      .filter((definition) => definition.producesRefs.includes('application.surface'))

    for (const definition of surfaceCapabilities) {
      expect(definition.requiredScopes, definition.id).toContain('navigation')
      expect(definition.successEvidence.join(' '), definition.id).toMatch(
        /Surface|页面|工作区|编辑器|定位/
      )
    }
  })

  it('所有写入和导航能力都能把成功结果记成强类型 Effect', () => {
    const missing = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().flatMap((definition) => (
      !definition.readOnly
      && definition.control.impacts.some((impact) => impact.effect !== 'observe')
      && !definition.resolveObservedEffects
        ? [definition.id]
        : []
    ))
    expect(missing).toEqual([])

    const openCamera = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('open_camera_stage_project')
    const effects = openCamera?.resolveObservedEffects?.(
      { projectId: 'project-1' },
      { projectId: 'project-1', surfaceId: 'tool.camera_stage' },
    ) ?? []
    expect(effects.map((effect) => agentObservedEffectSchema.parse(effect))).toEqual([
      expect.objectContaining({
        effect: 'navigate',
        targetRefs: [{ kind: 'application.surface', id: 'tool.camera_stage' }],
      }),
    ])

    const createCamera = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('create_camera_stage_project')
    expect(createCamera?.outputSchema.safeParse({
      projectId: 'project-1', name: '缺少引用', defaultCameraId: 'camera-1',
      defaultStateKeyframeId: 'state-1', baseRevision: 1, revision: 1,
      scopeRevisions: { toolbox: 1 },
    }).success).toBe(false)
    const createdEffects = createCamera?.resolveObservedEffects?.(
      { name: '稳定引用测试' },
      {
        projectId: 'project-1', name: '稳定引用测试', defaultCameraId: 'camera-1',
        defaultStateKeyframeId: 'state-1', baseRevision: 1, revision: 1,
        scopeRevisions: { toolbox: 1 },
        resultRefs: [
          { kind: 'camera_stage.project', id: 'project-1' },
          { kind: 'camera_stage.camera', id: 'project-1:camera-1' },
          { kind: 'camera_stage.state_keyframe', id: 'project-1:state-1' },
        ],
      },
    ) ?? []
    expect(createdEffects.map((effect) => agentObservedEffectSchema.parse(effect))).toEqual([
      expect.objectContaining({
        effect: 'create',
        targetRefs: [
          { kind: 'camera_stage.project', id: 'project-1' },
          { kind: 'camera_stage.camera', id: 'project-1:camera-1' },
          { kind: 'camera_stage.state_keyframe', id: 'project-1:state-1' },
        ],
      }),
    ])
  })

  it('所有有控制影响的能力都能产出强类型 Effect，画布读写使用完整稳定引用', () => {
    const missing = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
      .filter((definition) => definition.control.impacts.length > 0 && !definition.resolveObservedEffects)
      .map((definition) => definition.id)
    expect(missing).toEqual([])

    const add = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('add_canvas_node')
    const created = add?.resolveObservedEffects?.(
      { projectId: 'project-1', nodeType: 'textInput', placement: { mode: 'viewport_center' } },
      { projectId: 'project-1', nodeId: 'node-1', nodeType: 'textInput', undoRef: 'undo-1' },
    ) ?? []
    expect(created.map((effect) => agentObservedEffectSchema.parse(effect))).toEqual([
      expect.objectContaining({
        effect: 'create', targetRefs: [{ kind: 'canvas.node', id: 'node-1' }],
      }),
    ])

    const read = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('get_canvas_project')
    const observed = read?.resolveObservedEffects?.(
      { projectId: 'project-1' },
      { project: { id: 'project-1' }, nodes: [{ id: 'node-1' }], edges: [{ id: 'edge-1' }], truncated: false },
    ) ?? []
    expect(observed.map((effect) => agentObservedEffectSchema.parse(effect))[0]).toMatchObject({
      effect: 'observe', verified: true,
      targetRefs: expect.arrayContaining([
        { kind: 'canvas.project', id: 'project-1' },
        { kind: 'canvas.node', id: 'node-1' },
        { kind: 'canvas.edge', id: 'edge-1' },
      ]),
    })
  })

  it('生成结果到画布有唯一正式桥梁，并产出精确节点 Effect', () => {
    const bridge = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('add_generation_result_to_canvas')
    expect(bridge).toBeDefined()
    expect(bridge?.acceptsRefs).toEqual(expect.arrayContaining([
      'canvas.project', 'generation.result',
    ]))
    expect(bridge?.producesRefs).toContain('canvas.node')
    expect(bridge?.inputSchema.safeParse({
      projectId: 'canvas-1',
      resultRef: { kind: 'generation.result', id: 'task-1' },
      placement: { mode: 'absolute', x: 320, y: 180 },
    }).success).toBe(true)
    const effects = bridge?.resolveObservedEffects?.(
      {
        projectId: 'canvas-1', resultRef: { kind: 'generation.result', id: 'task-1' },
        placement: { mode: 'absolute', x: 320, y: 180 },
      },
      {
        projectId: 'canvas-1', resultRef: { kind: 'generation.result', id: 'task-1' },
        mediaType: 'image', nodeId: 'node-1', nodeType: 'uploadNode',
        nodeRef: { kind: 'canvas.node', id: 'node-1' }, undoRef: 'undo-1',
        revision: 2, scopeRevisions: { canvas: 2 },
      },
    ) ?? []
    expect(effects).toEqual([expect.objectContaining({
      effect: 'create', entityTypes: ['canvas.node'],
      targetRefs: [{ kind: 'canvas.node', id: 'node-1' }],
    })])
  })
})
