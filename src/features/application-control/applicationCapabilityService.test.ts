// @vitest-environment jsdom
import '@/tests/canvasProjectFixture'
import { afterEach, describe, expect, it } from 'vitest'
import { createApplicationCallerGrant, revokeApplicationCallerGrant } from '@/core/application-control/callerContext'

import { useSettingsStore } from '@/stores/settingsStore'
import { getSettingsRegistryRevision } from '@/features/settings/application-control/settingsApplicationService'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { retainHostContextTracking } from '@/features/application-control/hostContext/hostContext'

import { createApplicationCapabilitySession } from './applicationCapabilityService'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useProjectStore } from '@/stores/projectStore'
import { getCanvasProjectInstance } from '@/features/canvas/application/canvasProjectInstances'
import { freezeApplicationWrites } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { readPersistedCanvasProjectSnapshot } from '@/features/canvas/application/canvasQueryService'
import { useNavigationStore } from '@/stores/navigationStore'
import { clearLogEvents, getLogEvents } from '@/core/logging'

const originalContrast = useSettingsStore.getState().themeSelection.contrast
afterEach(() => useSettingsStore.getState().setThemeContrast(originalContrast))

function grant() {
  return createApplicationCallerGrant({ callerId: 'local-test' })
}
const request = (requestId: string) => ({ requestId, signal: new AbortController().signal })
const read = { id: 'read_application_entity', version: 1, input: {
  ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_contrast'],
} }
const write = (value: string) => ({ id: 'change_application_entities', version: 2,
  expectedRevisions: { settings: getSettingsRegistryRevision() }, input: {
    summary: '改变色调', changes: [{ kind: 'set_properties', entityType: 'settings.registry',
      target: { kind: 'settings.registry', id: 'singleton' }, properties: { 'interface.theme_contrast': value } }],
  } })

describe('独立应用调用入口', () => {
  it('自动开放的导航与画布服务实际创建、复制并保存结果，不依赖旧助手运行', async () => {
    installHarnessNativeStorage()
    const beforeWorkspace = useNavigationStore.getState().activeWorkspace
    try {
      const session = createApplicationCapabilitySession(grant())
      const call = async (id: string, input: Record<string, unknown>) => {
        const definition = session.list().find(item => item.id === id)!
        expect(definition, id).toBeDefined()
        const result = await session.execute({ id, version: definition.version, input }, request(crypto.randomUUID()))
        expect(result.ok, JSON.stringify(result)).toBe(true)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      }
      await call('open_application_surface', { surfaceId: 'workspace.canvas' })
      expect(useNavigationStore.getState().activeWorkspace).toBe('nodes')
      await call('get_current_application_context', {})
      const project = await call('create_document', { kind: 'canvas', name: 'MCP 自动对齐测试' })
      const projectId = (project.resultRef as { id: string }).id
      expect(useProjectStore.getState().currentProjectId).toBeNull()
      const nodeId = (await getCanvasProjectInstance(projectId)).store.getState().addNode('textAnnotationNode', { x: 0, y: 0 }, { text: '复制源', displayName: '原节点' })
      const duplicated = await call('duplicate_canvas_node', { documentId: projectId, nodeId, placement: { mode: 'absolute', x: 400, y: 0 } })
      const saved = await readPersistedCanvasProjectSnapshot(projectId)
      expect(saved.nodes.find(node => node.id === duplicated.nodeId)?.data.displayName).toContain('原节点')
      expect(saved.nodes).toHaveLength(2)
      await call('open_document', { documentId: projectId })
      await call('select_canvas_node', { documentId: projectId, nodeId: null })
      await call('get_canvas_node_schema', { nodeType: 'textAnnotationNode' })
    } finally {
      useNavigationStore.getState().setActiveWorkspace(beforeWorkspace)
      uninstallHarnessNativeStorage()
    }
  })
  it('退出最终保存期间拒绝新调用，关闭失败恢复后同一授权仍可使用', async () => {
    const session = createApplicationCapabilitySession(grant())
    const unfreeze = freezeApplicationWrites()
    try { await expect(session.execute(read, request('closing'))).rejects.toThrow('APPLICATION_CLOSING') }
    finally { unfreeze() }
    expect((await session.execute(read, request('resumed'))).ok).toBe(true)
  })
  it('普通修改省略基线时自动读取当前状态，仍经正式事务写入', async () => {
    const session = createApplicationCapabilitySession(grant())
    const target = originalContrast === 'soft' ? 'strong' : 'soft'
    const result = await session.execute({ ...write(target), expectedRevisions: undefined }, request('automatic-contrast'))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(useSettingsStore.getState().themeSelection.contrast).toBe(target)
  })
  it('不需要助手运行或脚本即可通过正式注册表读取', async () => {
    const result = await createApplicationCapabilitySession(grant()).execute(read, request('read'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.properties).toEqual({ 'interface.theme_contrast': originalContrast })
  })

  it('有权内存事务经原执行器写入，再从正式状态读回', async () => {
    const dispose = retainHostContextTracking()
    try {
      const session = createApplicationCapabilitySession(grant())
      const target = originalContrast === 'soft' ? 'strong' : 'soft'
      const result = await session.execute(write(target), request('write-contrast'))
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(useSettingsStore.getState().themeSelection.contrast).toBe(target)
      const readback = await session.execute(read, request('read-after'))
      expect(readback.ok).toBe(true)
      if (readback.ok) expect(readback.data.properties).toEqual({ 'interface.theme_contrast': target })
    } finally { dispose() }
  })





  it('对象克隆和已撤销的授权均不可执行', async () => {
    const authorized = grant()
    expect(() => createApplicationCapabilitySession({ ...authorized })).toThrow(/重新授权/)
    const session = createApplicationCapabilitySession(authorized)
    revokeApplicationCallerGrant(authorized)
    await expect(session.execute(read, request('revoked'))).rejects.toThrow(/重新授权/)
  })



  it('描述遵守实体公开声明，不开放助手内部运行目录', async () => {
    const session = createApplicationCapabilitySession(grant())
    const result = await session.execute({ id: 'describe_application_entities', version: 1, input: {} }, request('describe'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const properties = result.data.properties as Array<{ id: string; entityType: string }>
      const registry = getApplicationReflectionRegistry()
      expect(properties.every((value) => registry.listProperties(value.entityType)
        .some((entry) => entry.id === value.id && entry.exposures.includes('assistant')))).toBe(true)
    }
    const internal = getApplicationReflectionRegistry().describe({ domains: ['assistant_runtime'] }, {
      exposure: 'local_adapter', acceptedDataClasses: new Set(['C0', 'C1']),
    })
    expect(internal.entities).toEqual([])
    for (const entityType of ['assistant.run', 'assistant.artifact']) {
      const denied = await session.execute({ id: 'list_application_entities', version: 1, input: { entityType } }, request(`deny-${entityType}`))
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.error.message).toContain('ENTITY_TYPE_NOT_FOUND')
    }
  })

  it('引用不存在按可自纠的 NOT_FOUND 分类，日志不记成应用错误', async () => {
    installHarnessNativeStorage()
    try {
    const session = createApplicationCapabilitySession(grant())
    clearLogEvents()
    const missing = await session.execute(
      { ...read, input: { ref: { kind: 'canvas.document', id: 'not-persisted-project' }, propertyIds: ['canvas.document.name'] } },
      request('missing-ref')
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      // 分类要落在"这个引用不存在"，并原样保留取稳定 id 的指引，不能退化成兜底的执行失败。
      expect(missing.error.code).toBe('NOT_FOUND')
      expect(missing.error.recoverable).toBe(true)
      expect(missing.error.message).toContain('ENTITY_NOT_FOUND')
      expect(missing.error.message).toContain('list_application_entities')
    }
    /*
     * 外部调用方拿错引用是正常流量：失败事实照旧回传，但不得刷满用户的错误日志，也不得
     * 让任何覆盖引用契约的真实验收永远变红。日志级别必须与上面看到的分类是同一个判断。
     */
    const failed = getLogEvents().filter((event) => event.event === 'application.capability.execute.failed')
    expect(failed.length).toBe(1)
    expect(failed[0].level).toBe('warn')
    expect(getLogEvents().some((event) => event.level === 'error')).toBe(false)
    } finally { uninstallHarnessNativeStorage() }
  })

  it('截断引用和过期并发基线不会被外部适配器自动修复', async () => {
    const session = createApplicationCapabilitySession(grant())
    const truncated = await session.execute({ ...read, input: { ...read.input, ref: { kind: 'settings.registry', id: 'single...' } } }, request('truncated'))
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.error.message).toContain('完整稳定引用')
    const stale = await session.execute({ ...write('soft'), expectedRevisions: { settings: 999999 } }, request('stale'))
    expect(stale.ok).toBe(false)
    expect(useSettingsStore.getState().themeSelection.contrast).toBe(originalContrast)
  })
})
