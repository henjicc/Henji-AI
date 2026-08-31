import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION } from '../../../../../src/core/assistant/hostContracts'
import {
  applicationCapabilityDiscoveryOutputSchema,
  type ApplicationCapabilityDiscoveryOutput,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '../../../../../src/core/assistant/applicationCapabilities'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentCapabilityDiscoveryCatalog } from './capability-discovery'
import { hydrateHenjiScriptApi } from './script-api-hydration'

/** 一份最小的发现结果，只用来单测 hydrate 这一步；其余字段全走 schema 默认值。 */
function baseOutput(): ApplicationCapabilityDiscoveryOutput {
  return applicationCapabilityDiscoveryOutputSchema.parse({
    discoveryVersion: 'application-capability-discovery/v3',
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    fingerprint: `sha256:${'0'.repeat(64)}`,
    reused: false,
    capabilities: [],
    leasedToolNames: [],
    deferredToolNames: [],
    deferredCount: 0,
    page: { returnedItems: 0, nextCursor: null, hasMore: false },
  })
}

describe('hydrateHenjiScriptApi', () => {
  it('最终租约只保留反射真实存在的实体，不把 Surface 或临时 token 宣称为通用实体', () => {
    const output = {
      ...baseOutput(),
      scriptApi: {
        ...baseOutput().scriptApi,
        entities: {
          ...baseOutput().scriptApi.entities,
          entityTypes: [
            'image_edit.preview',
            'generation.record',
            'application.surface',
            'generation.preparation',
            'canvas.batch_plan',
          ],
        },
      },
    }
    const description = {
      entities: [
        { id: 'image_edit.preview', title: '图片编辑预览', description: '不可变预览', parentTypes: [] },
        { id: 'generation.record', title: '生成历史记录', description: '持久历史', parentTypes: [] },
      ],
      properties: [],
    }

    const hydrated = hydrateHenjiScriptApi(output, description)

    expect(hydrated.scriptApi.entities.entityTypes).toEqual([
      'image_edit.preview',
      'generation.record',
    ])
    const reflected = new Set((description.entities).map((entity) => entity.id))
    expect(hydrated.scriptApi.entities.entityTypes.every((entityType) => reflected.has(entityType))).toBe(true)
  })

  it('把请求中经反射确认的实体加入租约，但不回声伪造实体', () => {
    const output = {
      ...baseOutput(),
      scriptApi: {
        ...baseOutput().scriptApi,
        entities: {
          ...baseOutput().scriptApi.entities,
          entityTypes: ['image_edit.preview'],
        },
      },
    }
    const hydrated = hydrateHenjiScriptApi(output, {
      entities: [
        { id: 'image_edit.preview', title: '图片编辑预览', description: '不可变预览', parentTypes: [] },
        { id: 'image_edit.layer', title: '图片图层', description: 'V3 实时图层', parentTypes: ['image_edit.document'] },
      ],
      properties: [],
    }, ['image_edit.layer', 'image_edit.not_real'])

    expect(hydrated.scriptApi.entities.entityTypes).toEqual([
      'image_edit.layer',
      'image_edit.preview',
    ])
    expect(hydrated.scriptApi.entities.entityTypes).not.toContain('image_edit.not_real')
  })

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

  /*
   * 门禁：进了投影的实体，它的属性要全给，不能只给能力 impacts 点过名的那几条。
   *
   * impacts 是按"这个操作影响什么"写的，天然不完整。素材库能力声明了 asset.tags 却没声明
   * asset.library.name，旧实现拿 propertyIds 当过滤器，模型拿到的投影里就根本没有名称字段——
   * 实测它试了几次之后停下来问用户"素材库的名称应该写在哪个属性上"。它不是不会做，是被投影
   * 告知这个字段不存在。软信号不得当硬过滤，这条和 structuralMatch 那条是同一句话。
   */
  it('能力 impacts 没点名的属性也必须进投影，只影响排序', () => {
    const output = {
      ...baseOutput(),
      scriptApi: {
        ...baseOutput().scriptApi,
        entities: {
          ...baseOutput().scriptApi.entities,
          entityTypes: ['asset.library'],
          // 只有 impacts 声明过的这一条
          propertyIds: ['asset.tags'],
        },
      },
    }
    const hydrated = hydrateHenjiScriptApi(output, {
      entities: [{ id: 'asset.library', title: '素材库', description: '素材集合', parentTypes: [] }],
      properties: [{
        id: 'asset.tags', entityType: 'asset.library', title: '标签', description: '标签',
        value: { kind: 'string', maxLength: 40 }, writable: true, writeOperations: ['append', 'remove'],
      }, {
        id: 'asset.library.name', entityType: 'asset.library', title: '名称', description: '素材库名称',
        value: { kind: 'string', maxLength: 120 }, writable: true, writeOperations: ['set'],
      }],
    })

    const ids = hydrated.scriptApi.entities.propertyDefinitions.map((item) => item.id)
    expect(ids).toContain('asset.library.name')
    // impacts 声明过的排在前面：它仍然是排序信号，只是不再决定有无
    expect(ids[0]).toBe('asset.tags')
    expect(hydrated.scriptApi.entities.propertyIds).toContain('asset.library.name')
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
