import { describe, expect, it } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { AgentTaskCapabilityKind } from '../../../../../src/core/assistant/taskGraph'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AGENT_CORE_TOOL_NAMES } from './tool-activation'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'

/**
 * 门禁：**注册好的能力，模型必须找得到。**
 *
 * 这条守的不是某个 bug，是一整类事故。已经发生四次，每次形状完全一样：发现层拿模型填的某个
 * 软信号（targetSurfaceIds / entityTypes / capabilityKinds / 导航 Surface）做硬过滤，模型填得
 * 稍有出入，某个明明注册好的能力就从目录里整个消失。模型于是如实回答"应用没有这个能力"——
 * 它没说谎，它看到的目录里真的没有。用户看到的却是一句凭空的能力否认，而且每次换个域、换个
 * 说法就复现一次，永远修不完。
 *
 * 真正的根因是「过滤」这个动作本身：这些字段全部来自模型对任务的**猜测**，猜错的代价不该是
 * 能力消失。所以准入只保留域（注册表定义的、模型只是转述），其余全部降级成排序信号。
 * 这条门禁就是那条规则的机器表述——任何一处重新变回硬过滤，这里当场变红。
 *
 * ── 与账本门禁的分工（两条合起来才是完整命题）──
 * `src/features/assistant/applicationCapabilities/storeActionCoverage.test.ts` 守的是
 * 「账本里 capability 绑定指向的 id 确实存在于目录」；这里守的是「目录里的能力确实找得到」。
 * 两条合起来 = **人在界面上能做的每件事，助手声明的那条路真的走得通**。分成两条是因为账本
 * 在渲染层、发现层在主进程，跨层 import 会破坏架构边界。任何一条被删掉，命题就断了。
 */

/** 模型真实会填的 kinds 组合，含实测那次翻车的那一组。 */
const KIND_SETS: readonly (readonly AgentTaskCapabilityKind[])[] = [
  [],
  ['observe'],
  ['query'],
  ['plan'],
  ['mutate'],
  ['navigate'],
  ['execute'],
  // 实测「给场景加个球」那次模型声明的就是这一组：不含 execute，于是 place_camera_stage_object 消失。
  ['observe', 'query', 'plan', 'mutate'],
  // 混合意图：「打开三维编辑器并放个球」。navigate 在场时旧实现会额外按 Surface 硬过滤。
  ['navigate', 'mutate'],
]

/**
 * 故意填错的实体与页面。
 *
 * 不是刁难：模型兜底 Facet 的 targetSurfaceId 填的就是**快照里的当前页面**（用户此刻站在
 * 哪儿），域被延续证据放宽后 entityTypes 也留在上一个域上。这两个值填不准是常态，不是异常。
 */
const WRONG_ENTITY_TYPE = 'diagnostics.event'
const WRONG_SURFACE_ID = 'workspace.generation'

function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-reachability',
    revision: 5,
    scopeRevisions: { navigation: 2, generation: 1, canvas: 3, toolbox: 4, assets: 1 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: { id: 'tool.camera_stage', kind: 'tool', focusedRef: null, selectedRefs: [] },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: registry.allDefinitions()
      .filter((definition) => definition.side === 'frontend')
      .map((definition) => definition.name),
    capturedAt: new Date().toISOString(),
  }
}

function buildRegistry(): ReturnType<typeof createBuiltinAgentToolRegistry> {
  return createBuiltinAgentToolRegistry(async () => {
    throw new Error('测试不执行前端工具')
  })
}

interface CatalogedCapability {
  name: string
  domain: string
  entityTypes: string[]
  effects: string[]
}

function catalogedCapabilities(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): CatalogedCapability[] {
  const context = fullContext(registry)
  const listed = new Set(registry.list(context).map((entry) => entry.name))
  return registry.allDefinitions().flatMap((definition) => {
    const capability = definition.capability
    if (!capability || !listed.has(definition.name)) return []
    const impacts = capability.control?.impacts ?? []
    return [{
      name: definition.name,
      domain: capability.domain,
      entityTypes: [...new Set([
        ...capability.acceptsRefs,
        ...capability.producesRefs,
        ...impacts.flatMap((impact) => impact.entityTypes),
      ])],
      effects: [...new Set(impacts.map((impact) => impact.effect))],
    }]
  })
}

describe('能力可达性', () => {
  /*
   * 核心地板工具（通用动词、能力发现、技能加载、产物回读）不参与目录轮换，永远常驻，
   * 因此不需要也不应该被"发现得到"约束——它们本来就不经过发现。
   */
  const coreNames = new Set<string>(AGENT_CORE_TOOL_NAMES)

  it('任何 kinds 组合下，域内能力都不会从发现结果里消失', () => {
    const registry = buildRegistry()
    const context = fullContext(registry)
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const capabilities = catalogedCapabilities(registry).filter((item) => !coreNames.has(item.name))
    // 防空转：目录规模掉到这个数以下说明注册链路本身出问题了，下面的遍历会假绿。
    expect(capabilities.length).toBeGreaterThan(60)

    const domains = [...new Set(capabilities.map((item) => item.domain))]
    const missing: string[] = []
    for (const domain of domains) {
      const expected = capabilities.filter((item) => item.domain === domain)
      for (const [index, kinds] of KIND_SETS.entries()) {
        const output = catalog.discover(`reachability-${domain}-${index}`, {
          discoveryVersion: 'application-capability-discovery/v2',
          facets: [{
            facetId: 'probe',
            queries: [],
            domains: [domain],
            // 实体与页面一律填错：模型填不准是常态，不该因此丢能力。
            entityTypes: [WRONG_ENTITY_TYPE],
            capabilityKinds: [...kinds],
            targetSurfaceIds: [WRONG_SURFACE_ID],
          }],
          cursor: 0,
          limit: 48,
        }, context)
        const found = new Set(output.capabilities.map((item) => item.name))
        for (const item of expected) {
          if (!found.has(item.name)) {
            missing.push(`${item.name}（域 ${domain} / effect ${item.effects.join('+')} / kinds [${kinds.join(',') || '空'}]）`)
          }
        }
      }
    }

    expect(missing, [
      '以下能力在自己的域里都发现不了——模型会如实回答"应用没有这个能力"，而它其实注册好了：',
      ...missing,
      '发现层的准入只允许按域判断，其余信号一律降级为排序（见 capability-discovery.structuralMatch）。',
    ].join('\n')).toEqual([])
  })

  it('模型把实体和 effect 都说对时，能力必须真的进租约', () => {
    const registry = buildRegistry()
    const context = fullContext(registry)
    const catalog = new AgentCapabilityDiscoveryCatalog(registry)
    const capabilities = catalogedCapabilities(registry).filter((item) => !coreNames.has(item.name))
    expect(capabilities.length).toBeGreaterThan(60)

    /*
     * 上一条守"看得见"，这条守"拿得到"。
     *
     * 发现得到但租不到，对模型是同一种结局：下一轮的活动工具集里没有它，调用直接
     * TOOL_NOT_ACTIVE。租约名额有限（每个 Facet 12 个），所以这里不苛求"整域全租"，只要求
     * **模型把实体和 effect 都描述对时**那个能力必须排进去——这正是任务图正常工作时的形状。
     */
    const unleased: string[] = []
    for (const item of capabilities) {
      const output = catalog.discover(`lease-${item.name}`, {
        discoveryVersion: 'application-capability-discovery/v2',
        facets: [{
          facetId: 'probe',
          queries: [],
          domains: [item.domain],
          entityTypes: item.entityTypes,
          capabilityKinds: [],
          targetSurfaceIds: [],
          requiredEffects: item.effects.map((effect) => ({
            effect: effect as 'observe' | 'create' | 'update' | 'delete' | 'navigate' | 'execute',
            entityTypes: item.entityTypes,
            propertyIds: [],
          })),
        }],
        cursor: 0,
        limit: 48,
      }, context)
      if (!output.leasedToolNames.includes(item.name)) {
        unleased.push(`${item.name}（域 ${item.domain} / effect ${item.effects.join('+')}）`)
      }
    }

    expect(unleased, [
      '以下能力即使模型把实体和 effect 都说对了也拿不到租约，下一轮调用会 TOOL_NOT_ACTIVE：',
      ...unleased,
    ].join('\n')).toEqual([])
  })
})
