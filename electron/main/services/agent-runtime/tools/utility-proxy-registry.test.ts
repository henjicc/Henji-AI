import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import type { ApplicationCapabilityDiscoveryOutput } from '../../../../../src/core/assistant/capabilityDiscovery'
import { createUtilityProxyRegistries } from './utility-proxy-registry'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-utility',
    revision: 7,
    scopeRevisions: {
      navigation: 1, generation: 2, canvas: 3, toolbox: 4, assets: 5, settings: 6,
    },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    capturedAt: new Date().toISOString(),
  }
}

describe('createUtilityProxyRegistries', () => {
  it('本地能力发现会经主进程读取渲染层反射并水合 scriptApi', async () => {
    const context = hostContext()
    const executeMainTool = vi.fn(async (payload: { toolName: string }) => {
      expect(payload.toolName).toBe('describe_application_entities')
      return {
        output: {
          entities: [{
            id: 'settings.registry', title: '应用设置', description: '设置集合', parentTypes: [],
          }],
          properties: [{
            id: 'interface.theme_tone', entityType: 'settings.registry', title: '主题色调',
            description: '主题色调', writable: true, writeOperations: ['set'],
            value: { kind: 'enum', values: [
              { value: 'neutral', label: '中性' },
              { value: 'warm', label: '暖色' },
              { value: 'cool', label: '冷色' },
            ] },
          }],
          propertyAvailability: [], collectionAvailability: [],
        },
        hostContext: context,
      }
    })
    const registries = createUtilityProxyRegistries({
      executeMainTool,
      resolveThreadId: () => 'thread-utility',
      getHostContext: () => context,
      rememberHostContext: vi.fn(),
      artifactAccess: {
        describe: () => { throw new Error('测试不读取 artifact') },
        read: () => { throw new Error('测试不读取 artifact') },
      },
    })
    context.availableCapabilities = registries.catalogRegistry.allDefinitions().map((item) => item.name)
    const discovery = registries.registry.get('discover_application_capabilities')
    const output = await discovery?.execute({
      discoveryVersion: 'application-capability-discovery/v3',
      queries: ['修改 interface.theme_tone'],
      domains: ['settings'],
      entityTypes: ['settings.registry'],
      writes: true,
      cursor: 0,
      limit: 20,
    }, {
      runId: 'run-utility', threadId: 'thread-utility', toolCallId: 'call-discovery',
      signal: new AbortController().signal, hostContext: context,
    }) as ApplicationCapabilityDiscoveryOutput | undefined

    expect(executeMainTool).toHaveBeenCalledTimes(1)
    expect(output?.scriptApi.entities.propertyDefinitions).toEqual([
      expect.objectContaining({
        id: 'interface.theme_tone',
        value: expect.objectContaining({ kind: 'enum' }),
      }),
    ])
  })
})

