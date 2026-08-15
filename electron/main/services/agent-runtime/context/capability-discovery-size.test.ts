import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { applicationCapabilityDiscoveryInputSchema } from '../../../../../src/core/assistant/capabilityDiscovery'
import { discoverApplicationCapabilitiesCapability } from '../../../../../src/core/assistant/capabilities/capabilityDiscoveryApplicationCapabilities'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'
import { resolveOffloadByteThreshold, shouldOffloadObservation } from './offload'

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

  const scenarios = [
    {
      name: '三维场景写入',
      input: { queries: ['在三维场景放置对象并做动画'], domains: ['camera_stage'], entityTypes: ['camera_stage.object'], writes: true },
    },
    {
      name: '设置读改',
      input: { queries: ['修改设置值再恢复'], domains: ['settings'], entityTypes: ['settings.registry'], writes: true },
    },
    {
      name: '画布编排',
      input: { queries: ['画布上串联节点'], domains: ['canvas'], entityTypes: ['canvas.node'], writes: true },
    },
  ]

  /*
   * 门禁判的是**历史投影后**的体积——那才是真正进对话历史、决定要不要卸载的东西。
   * 上下文窗口按当前主模型档案的量级取，阈值由 resolveOffloadByteThreshold 推导。
   */
  it.each(scenarios)('$name 的历史投影不触发 artifact 卸载', ({ input, name }) => {
    const output = catalog.discover(
      `size-${name}`,
      applicationCapabilityDiscoveryInputSchema.parse(input),
      context
    )
    const projected = discoverApplicationCapabilitiesCapability.projectForHistory?.(output) ?? output
    const bytes = Buffer.byteLength(JSON.stringify(projected), 'utf8')
    const threshold = resolveOffloadByteThreshold(64_000)

    expect(
      shouldOffloadObservation(projected, threshold),
      `${name} 投影 ${bytes} 字节 / 阈值 ${threshold}：`
      + '越过阈值就会被存成 artifact，模型只能分页回读，实测会把运行拖到不收敛。',
    ).toBe(false)
  })
})
