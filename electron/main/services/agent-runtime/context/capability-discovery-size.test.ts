import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { applicationCapabilityDiscoveryInputSchema } from '../../../../../src/core/assistant/capabilityDiscovery'
import { discoverApplicationCapabilitiesCapability } from '../../../../../src/core/assistant/capabilities/capabilityDiscoveryApplicationCapabilities'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'
import { AGENT_TOOL_DOMAINS } from './types'
import {
  resolveOffloadByteThreshold,
  resolveToolOffloadByteThreshold,
  shouldOffloadObservation,
} from './offload'

/*
 * 发现结果是整次运行里最大的一条工具结果。它一旦越过卸载阈值就会被存成 artifact，模型只能
 * 用 read_agent_artifact 一页页读回来——实测一次运行因此产生 18 次回读、9 轮仍未收敛。
 *
 * 所以体积不是"优化项"，是**行为正确性**：投影塞得越多，模型看到的越少。
 */
function fullContext(registry: ReturnType<typeof createBuiltinAgentToolRegistry>): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-size',
    revision: 1,
    scopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1 },
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

describe('能力发现结果的体积', () => {
  const registry = createBuiltinAgentToolRegistry(async () => {
    throw new Error('测试不执行前端工具')
  })
  const catalog = new AgentCapabilityDiscoveryCatalog(registry)
  const context = fullContext(registry)

  /**
   * 每个域**真实注册**的实体类型，从注册表推导，不手写。
   *
   * 用真实实体而不是空数组，是因为空数组会让全域 Recipe 一次性进投影
   * （见 capability-discovery.ts 的 `applicableScriptRecipes`），那是最大的一份投影——
   * 但 64 次真实 discover 调用里模型填空的次数是 **0**，拿它当门禁等于用自造的输入判缺陷。
   *
   * 真实的三种形状里，体积从大到小是：模型把实体**猜对** > 猜错 > 留空（留空反而因为
   * Recipe 全进而最大，但它不发生）。猜错时 Recipe 过滤掉大半，投影更小。
   * 所以门禁盯**猜对**这一档——它是现实中最大的那份。
   */
  function realEntityTypes(domain: string): string[] {
    return [...new Set(registry.allDefinitions().flatMap((definition) => {
      const capability = definition.capability
      if (!capability || capability.domain !== domain) return []
      return [
        ...capability.acceptsRefs,
        ...capability.producesRefs,
        ...(capability.control?.impacts.flatMap((impact) => impact.entityTypes) ?? []),
      ]
    }))].slice(0, 24)
  }

  /*
   * 穷举全部域 × {只读, 读写}，不再手挑三个场景。
   *
   * 手挑场景守的是"我想到的那几个域没超标"，而超标是**注册数据的函数**——某个域多注册两条
   * 能力、某条能力的 schema 长了一截，就可能越线。没被挑中的域没有任何东西盯着它，
   * 它第一次超标只会在真机跑里以"18 次 read_agent_artifact、9 轮不收敛"的形式出现。
   *
   * 遍历成本是毫秒级：`discover` 是纯计算，17 个域跑两遍也就几百毫秒。
   */
  const scenarios = AGENT_TOOL_DOMAINS.flatMap((domain) => {
    const entityTypes = realEntityTypes(domain)
    return [
      {
        name: `${domain}·只读`,
        input: { queries: [`读取 ${domain} 域的当前状态`], domains: [domain], entityTypes, writes: false },
      },
      {
        name: `${domain}·读写`,
        input: { queries: [`修改 ${domain} 域的内容并验证`], domains: [domain], entityTypes, writes: true },
      },
    ]
  })

  it('遍历规模符合预期，否则下面的断言会假绿', () => {
    expect(scenarios.length).toBe(AGENT_TOOL_DOMAINS.length * 2)
    expect(AGENT_TOOL_DOMAINS.length).toBeGreaterThanOrEqual(17)
    // 有能力的域必须真的推导出实体，否则等于在空输入上跑遍历。
    const domainsWithEntities = scenarios.filter((scenario) => scenario.input.entityTypes.length > 0)
    expect(domainsWithEntities.length).toBeGreaterThan(scenarios.length / 2)
  })

  /**
   * 必须用**生产同一把尺子**：`resolveToolOffloadByteThreshold(工具名, 窗口)`。
   *
   * 这里原本调的是通用的 `resolveOffloadByteThreshold(64_000)`（19200 字节）。但
   * `discover_application_capabilities` 有专属内联下限（`INLINE_FLOOR_BY_TOOL` 128KiB，
   * 受 60% 窗口上限约束后是 76800 字节），生产的 `runner-results.toolMessage` 与
   * `prompt-layers.formatObservation` 两处用的都是带工具名的那个。
   *
   * 用错尺子的方向是"更严"，所以不会放过真超标，但会**造出假红**：实测 canvas 三实体投影
   * 28804 字节，按 19200 判是超标 150%，按真实的 76800 判只占 37%。门禁自己算错了阈值，
   * 下一个人只会照着假红去压投影，压的是一个不存在的问题。
   *
   * 这与旁边 `offload-same-ruler.test.ts` 守的是同一条规则——只是那条守生产两处同尺子，
   * 这里补上"门禁与生产也必须同尺子"。
   */
  const DISCOVERY_TOOL = 'discover_application_capabilities'
  const CONTEXT_WINDOW = 64_000

  it('门禁用的阈值与生产一致，而不是更严的通用阈值', () => {
    const toolThreshold = resolveToolOffloadByteThreshold(DISCOVERY_TOOL, CONTEXT_WINDOW)
    const genericThreshold = resolveOffloadByteThreshold(CONTEXT_WINDOW)
    expect(
      toolThreshold,
      '发现工具有专属内联下限，阈值必须严格大于通用阈值；相等说明下限被误删，'
      + '门禁会退回"更严"的旧行为并制造假红。',
    ).toBeGreaterThan(genericThreshold)
  })

  /*
   * 门禁判的是**历史投影后**的体积——那才是真正进对话历史、决定要不要卸载的东西。
   */
  it.each(scenarios)('$name 的历史投影不触发 artifact 卸载', ({ input, name }) => {
    const output = catalog.discover(
      `size-${name}`,
      applicationCapabilityDiscoveryInputSchema.parse(input),
      context
    )
    const projected = discoverApplicationCapabilitiesCapability.projectForHistory?.(output) ?? output
    const bytes = Buffer.byteLength(JSON.stringify(projected), 'utf8')
    const threshold = resolveToolOffloadByteThreshold(DISCOVERY_TOOL, CONTEXT_WINDOW)

    expect(
      shouldOffloadObservation(projected, threshold),
      `${name} 投影 ${bytes} 字节 / 阈值 ${threshold}：`
      + '越过阈值就会被存成 artifact，模型只能分页回读，实测会把运行拖到不收敛。',
    ).toBe(false)
  })

  /*
   * 只判"没越线"不够：越线是突变，而逼近是渐变。某个域悄悄涨到阈值的九成时，
   * 下一条能力就会把它推过去，而那时人已经不记得这里有条线了。
   *
   * 余量线取 0.8：实测当前最大的一份（canvas 三实体 28804 字节）占 37%，离 80% 还很远，
   * 所以这条线现在不挡任何东西，只在体积翻倍时提前叫一声。
   */
  it.each(scenarios)('$name 的历史投影距离卸载阈值仍有余量', ({ input, name }) => {
    const output = catalog.discover(
      `headroom-${name}`,
      applicationCapabilityDiscoveryInputSchema.parse(input),
      context
    )
    const projected = discoverApplicationCapabilitiesCapability.projectForHistory?.(output) ?? output
    const bytes = Buffer.byteLength(JSON.stringify(projected), 'utf8')
    const threshold = resolveToolOffloadByteThreshold(DISCOVERY_TOOL, CONTEXT_WINDOW)
    const ratio = bytes / threshold

    expect(
      ratio,
      `${name} 投影 ${bytes} 字节，已占阈值 ${threshold} 的 ${(ratio * 100).toFixed(0)}%：`
      + '还没越线，但余量已经不足两成，再加一条能力就会被卸载。先压投影，别等真机跑发现。',
    ).toBeLessThan(0.8)
  })
})
