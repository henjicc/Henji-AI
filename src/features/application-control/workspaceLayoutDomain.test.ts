// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { installHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { applicationReflectionHandlers } from './capabilities/applicationReflectionAdapter'
import { listWorkspaceLayoutControllers, workspaceLayoutController } from '@/services/workspaceLayouts/workspaceLayoutService'

const target = { kind: 'workspace_layout.workspace', id: 'video_edit' }
const context = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal, expectedRevisions: { workspace_layout: listWorkspaceLayoutControllers().reduce((sum, controller) => sum + controller.getSnapshot().revision, 0) } })
const read = async () => applicationReflectionHandlers.readEntity({ ref: target, propertyIds: ['workspace_layout.workspace.active_id'] }, context())
describe('工作区布局正式应用能力', () => {
  beforeAll(async () => {
    installHarnessNativeStorage()
    await Promise.all(listWorkspaceLayoutControllers().map(controller => controller.load()))
  })
  it('通过 describe 和通用 change 切换预设，正式状态与读回一致', async () => {
    const described = await applicationReflectionHandlers.describeEntities({ domains: ['workspace_layout'], entityTypes: [], refs: [target] }, context())
    expect(described.propertyAvailability[0].properties).toContainEqual(expect.objectContaining({ propertyId: 'workspace_layout.workspace.active_id', writable: true }))
    await applicationReflectionHandlers.changeEntities({ summary: '切换调色布局', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties: { 'workspace_layout.workspace.active_id': 'grading' } }] }, context())
    expect(workspaceLayoutController('video_edit').getSnapshot().activeId).toBe('grading')
    expect((await read()).properties['workspace_layout.workspace.active_id']).toBe('grading')
  })
  it('通过通用集合另存预设并重命名删除，内置预设的写入被拒绝', async () => {
    await applicationReflectionHandlers.changeEntities({ summary: '另存布局', changes: [{ kind: 'create_items', parent: target, entityType: 'workspace_layout.preset', items: [{ properties: { 'workspace_layout.preset.name': '助手布局' } }] }] }, context())
    const controller = workspaceLayoutController('video_edit')
    const id = controller.getSnapshot().users.find(p => p.name === '助手布局')!.id
    const preset = { kind: 'workspace_layout.preset', id: `video_edit/${id}` }
    await applicationReflectionHandlers.changeEntities({ summary: '布局改名', changes: [{ kind: 'set_properties', target: preset, entityType: preset.kind, properties: { 'workspace_layout.preset.name': '我的布局' } }] }, context())
    const snapshot = await applicationReflectionHandlers.readEntity({ ref: preset, propertyIds: ['workspace_layout.preset.name'] }, context())
    expect(snapshot.properties['workspace_layout.preset.name']).toBe('我的布局')
    await applicationReflectionHandlers.changeEntities({ summary: '删除布局', changes: [{ kind: 'remove_items', parent: target, entityType: preset.kind, targets: [preset] }] }, context())
    expect(controller.getSnapshot().users.some(p => p.id === id)).toBe(false)
    const builtin = { kind: preset.kind, id: 'video_edit/editing' }
    const described = await applicationReflectionHandlers.describeEntities({ domains: ['workspace_layout'], entityTypes: [], refs: [builtin] }, context())
    expect(described.propertyAvailability[0].properties).toContainEqual(expect.objectContaining({ propertyId: 'workspace_layout.preset.name', writable: false }))
    await expect(applicationReflectionHandlers.changeEntities({ summary: '错误改名', changes: [{ kind: 'set_properties', target: builtin, entityType: builtin.kind, properties: { 'workspace_layout.preset.name': '不可改' } }] }, context())).rejects.toThrow()
  })
  it('公共写入可以撤销，缺少设置写权限和过期基线均不能改变布局', async () => {
    const controller = workspaceLayoutController('video_edit')
    const before = controller.getSnapshot().activeId
    const changes = [{ kind: 'set_properties' as const, target, entityType: target.kind, properties: { 'workspace_layout.workspace.active_id': before === 'editing' ? 'grading' : 'editing' } }]
    const changed = await applicationReflectionHandlers.changeEntities({ summary: '切换布局', changes }, context())
    expect(controller.getSnapshot().activeId).not.toBe(before)
    await applicationReflectionHandlers.undoEntities({ undoRef: changed.undoRef! }, context())
    expect(controller.getSnapshot().activeId).toBe(before)
    const grant = createApplicationCallerGrant({ callerId: 'layout-reader', capabilityIds: ['change_application_entities'], permissions: ['settings:read'], allowWrites: false, allowDestructive: false })
    await expect(applicationReflectionHandlers.changeEntities({ summary: '未授权写入', changes }, { ...context(), callerGrant: grant })).rejects.toThrow()
    expect(controller.getSnapshot().activeId).toBe(before)
    const writer = createApplicationCallerGrant({ callerId: 'layout-writer', capabilityIds: ['change_application_entities'], permissions: ['settings:read', 'settings:write'], allowWrites: true, allowDestructive: true })
    await expect(applicationReflectionHandlers.changeEntities({ summary: '过期写入', changes }, { ...context(), expectedRevisions: { workspace_layout: 0 }, callerGrant: writer })).rejects.toThrow()
    expect(controller.getSnapshot().activeId).toBe(before)
  })
  it('保存失败保留布局修改，公开 saved 属性仅重试落盘', async () => {
    const controller = workspaceLayoutController('video_edit')
    const next = controller.getSnapshot().activeId === 'editing' ? 'grading' : 'editing'
    const set = vi.spyOn(getPlatform().settings, 'set').mockRejectedValueOnce(new Error('DISK_FULL'))
    try {
      await expect(applicationReflectionHandlers.changeEntities({ summary: '切换布局', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties: { 'workspace_layout.workspace.active_id': next } }] }, context())).rejects.toMatchObject({ result: { persistence: { memoryState: 'modified', persistenceState: 'unconfirmed' } } })
      expect(controller.getSnapshot().activeId).toBe(next)
      expect(controller.getSnapshot().error).not.toBeNull()
      await applicationReflectionHandlers.changeEntities({ summary: '重试布局保存', changes: [{ kind: 'set_properties', target, entityType: target.kind, properties: { 'workspace_layout.workspace.saved': true } }] }, context())
      expect(controller.getSnapshot().error).toBeNull()
      expect(controller.getSnapshot().activeId).toBe(next)
      const record = await getPlatform().settings.get('workspace.layout.video_edit')
      expect(JSON.parse(record!.value).content.activeId).toBe(next)
    } finally { set.mockRestore() }
  })
})
