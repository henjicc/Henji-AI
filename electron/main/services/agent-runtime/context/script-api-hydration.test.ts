import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION } from '../../../../../src/core/assistant/hostContracts'
import type { ApplicationCapabilityDiscoveryOutput } from '../../../../../src/core/assistant/capabilityDiscovery'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'
import { hydrateHenjiScriptApi } from './script-api-hydration'

describe('hydrateHenjiScriptApi', () => {
  it('把反射层枚举约束投影到首次发现结果，不要求模型猜设置值', () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const discovered = new AgentCapabilityDiscoveryCatalog(registry).discover('run-settings-schema', {
      discoveryVersion: 'application-capability-discovery/v3',
      queries: ['修改 general.language 与 interface.theme_tone'],
      domains: ['settings'],
      entityTypes: ['settings.registry'],
      writes: true,
      cursor: 0,
      limit: 20,
    }, {
      schemaVersion: AGENT_CONTRACT_VERSION, rendererSessionId: 'renderer-1', revision: 1,
      scopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1 },
      workspace: { id: 'generation', activeToolId: null },
      project: { id: null, selectedNodeId: null }, generation: { commandReady: true },
      assets: { view: 'closed', selectedAssetId: null }, uiReady: true,
      availableCapabilities: registry.allDefinitions().map((item) => item.name),
      capturedAt: new Date().toISOString(),
    })

    const hydrated = hydrateHenjiScriptApi(discovered, {
      entities: [{
        id: 'settings.registry', title: '应用设置', description: '设置集合', parentTypes: [],
      }],
      properties: [{
        id: 'general.language', entityType: 'settings.registry', title: '语言', description: '界面语言',
        value: { kind: 'enum', values: [{ value: 'auto', label: '自动' }, { value: 'zh-CN', label: '中文' }] },
        writable: true, writeOperations: ['set'],
      }, {
        id: 'interface.theme_tone', entityType: 'settings.registry', title: '主题色调', description: '主题色调',
        value: { kind: 'enum', values: [
          { value: 'neutral', label: '中性' }, { value: 'warm', label: '暖色' }, { value: 'cool', label: '冷色' },
        ] },
        writable: true, writeOperations: ['set'],
      }],
    })

    expect(hydrated.scriptApi.entities.propertyDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'interface.theme_tone',
        value: { kind: 'enum', values: [
          { value: 'neutral', label: '中性' }, { value: 'warm', label: '暖色' }, { value: 'cool', label: '冷色' },
        ] },
      }),
    ]))
    expect(hydrated.scriptApi.entities.entityDefinitions).toEqual([
      expect.objectContaining({ id: 'settings.registry', parentTypes: [] }),
    ])
  })

  it('真实发现工具会先读取渲染层反射结构，再封存带约束的脚本租约', async () => {
    const registry = createBuiltinAgentToolRegistry(async (operation) => {
      expect(operation.capability.id).toBe('describe_application_entities')
      return {
        ok: true,
        data: {
          entities: [{ id: 'settings.registry', title: '应用设置', description: '设置集合', parentTypes: [] }],
          properties: [{
            id: 'interface.theme_tone', entityType: 'settings.registry', title: '主题色调', description: '主题色调',
            value: { kind: 'enum', values: [
              { value: 'neutral', label: 'neutral' }, { value: 'warm', label: 'warm' }, { value: 'cool', label: 'cool' },
            ] },
            writable: true, writeOperations: ['set'],
          }],
          propertyAvailability: [], collectionAvailability: [],
        },
        resultingRevision: 1,
        resultingScopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1 },
      }
    })
    const tool = registry.get('discover_application_capabilities')
    expect(tool).toBeDefined()
    const output = await tool?.execute({
      discoveryVersion: 'application-capability-discovery/v3',
      queries: ['修改 general.language 与 interface.theme_tone'],
      domains: ['settings'],
      entityTypes: ['settings.registry'],
      writes: true,
      cursor: 0,
      limit: 20,
    }, {
      runId: 'run-integrated-discovery', threadId: 'thread-1', toolCallId: 'call-discover',
      signal: new AbortController().signal,
      hostContext: {
        schemaVersion: AGENT_CONTRACT_VERSION, rendererSessionId: 'renderer-1', revision: 1,
        scopeRevisions: { navigation: 1, generation: 1, canvas: 1, toolbox: 1, assets: 1 },
        workspace: { id: 'generation', activeToolId: null },
        project: { id: null, selectedNodeId: null }, generation: { commandReady: true },
        assets: { view: 'closed', selectedAssetId: null }, uiReady: true,
        availableCapabilities: registry.allDefinitions().map((item) => item.name),
        capturedAt: new Date().toISOString(),
      },
    }) as ApplicationCapabilityDiscoveryOutput | undefined

    expect(output?.scriptApi.entities.propertyDefinitions).toEqual([
      expect.objectContaining({
        id: 'interface.theme_tone',
        value: expect.objectContaining({ kind: 'enum' }),
      }),
    ])
  })
})


