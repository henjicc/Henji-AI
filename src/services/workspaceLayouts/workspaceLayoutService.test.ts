// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Orientation, type SerializedDockview } from 'dockview-react'
import { WorkspaceLayoutController, type WorkspaceLayoutRegistration, type WorkspaceLayoutStorage } from './workspaceLayoutService'
import { parseWorkspaceDockLayout } from '@/core/workspaceLayouts/validation'

const layout = (): SerializedDockview => ({ grid: { width: 1200, height: 800, orientation: Orientation.HORIZONTAL, root: { type: 'branch', data: [{ type: 'leaf', size: 1200, data: { id: 'main', views: ['preview'], activeView: 'preview' } }] } }, panels: { preview: { id: 'preview', contentComponent: 'preview', renderer: 'always', title: '预览' } }, activeGroup: 'main' })
function fixture(raw?: string, legacy?: () => SerializedDockview | undefined) {
  const data = new Map<string, string>(raw ? [['workspace.layout.test', raw]] : [])
  const storage: WorkspaceLayoutStorage = { read: vi.fn(async key => data.get(key)), write: vi.fn(async (key, value) => { data.set(key, value) }) }
  const alternate = layout(); alternate.grid.orientation = Orientation.VERTICAL
  const registration: WorkspaceLayoutRegistration = { workspaceId: 'test', panels: [{ id: 'preview', title: '预览' }], builtinPresets: [{ id: 'default', name: '默认', layout: layout() }, { id: 'focus', name: '专注', layout: alternate }], readLegacy: legacy }
  return { controller: new WorkspaceLayoutController(registration, storage), storage, data, registration }
}

describe('统一工作区布局预设', () => {
  it('内置改动只记当前布局，切回恢复保存值；用户预设支持增删改和覆盖', async () => {
    const { controller, data, registration, storage } = fixture()
    await controller.load()
    const changed = layout(); changed.grid.orientation = Orientation.VERTICAL
    await controller.updateCurrent(changed)
    expect(controller.getSnapshot().dirty).toBe(true)
    expect(controller.getSnapshot().presets[0].layout.grid.orientation).toBe(Orientation.HORIZONTAL)
    const id = await controller.saveAs(' 我的布局 ')
    expect(controller.getSnapshot()).toMatchObject({ activeId: id, dirty: false })
    await controller.rename(id, '工作')
    await controller.updateCurrent(layout()); await controller.overwrite(id)
    await controller.apply('focus'); await controller.apply(id)
    expect(controller.getSnapshot().current.grid.orientation).toBe(Orientation.HORIZONTAL)
    const reloaded = new WorkspaceLayoutController(registration, storage)
    await reloaded.load()
    expect(reloaded.getSnapshot().users[0].name).toBe('工作')
    await controller.remove(id)
    expect(controller.getSnapshot()).toMatchObject({ activeId: 'default', users: [] })
    expect(JSON.parse(data.values().next().value!).version).toBe(1)
  })
  it('只有主动切换预设才触发工作区专属动作，读取保存的布局不触发', async () => {
    const onApply = vi.fn()
    const { registration, storage } = fixture()
    const controller = new WorkspaceLayoutController({ ...registration, onApply }, storage)
    await controller.load()
    expect(onApply).not.toHaveBeenCalled()
    await controller.apply('focus')
    expect(onApply).toHaveBeenCalledWith('focus')
  })

  it('内置预设不可删除、重命名或覆盖，空名称不写配置', async () => {
    const { controller, storage } = fixture(); await controller.load()
    await expect(controller.remove('default')).rejects.toThrow('内置')
    await expect(controller.rename('default', '改名')).rejects.toThrow('内置')
    await expect(controller.overwrite('default')).rejects.toThrow('内置')
    await expect(controller.saveAs(' ')).rejects.toThrow('名称')
    expect(storage.write).not.toHaveBeenCalled()
  })
  it('旧布局只读取一次且不在 hydration 时落盘，保存后优先正式配置', async () => {
    const previous = layout(); previous.grid.orientation = Orientation.VERTICAL
    const legacy = vi.fn(() => previous)
    const { controller, storage, registration } = fixture(undefined, legacy)
    await controller.load(); await controller.load()
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().current.grid.orientation).toBe(Orientation.VERTICAL)
    expect(storage.write).not.toHaveBeenCalled()
    await controller.saveAs('迁移布局')
    const reloaded = new WorkspaceLayoutController(registration, storage); await reloaded.load()
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(previous).toEqual(controller.getSnapshot().current)
  })
  it.each(['broken', JSON.stringify({ version: 2, minReaderVersion: 2, content: { activeId: 'default', current: layout(), users: [] } })])('无法读取的配置禁止空库覆盖：%s', async raw => {
    const { controller, storage } = fixture(raw)
    await expect(controller.load()).rejects.toThrow()
    await expect(controller.saveAs('覆盖')).rejects.toThrow()
    expect(storage.write).not.toHaveBeenCalled()
  })
  it('可读的新版本保留版本戳与未知字段，串行保存失败后仍能重试', async () => {
    const raw = JSON.stringify({ version: 2, minReaderVersion: 1, extra: '保留', content: { activeId: 'default', current: layout(), users: [], future: { value: 1 } } })
    const { controller, data, storage } = fixture(raw); await controller.load()
    vi.mocked(storage.write).mockRejectedValueOnce(new Error('DISK_FULL'))
    await expect(controller.saveAs('待保存')).rejects.toThrow('DISK_FULL')
    expect(controller.getSnapshot().users[0].name).toBe('待保存')
    await controller.rename(controller.getSnapshot().activeId, '恢复保存')
    expect(JSON.parse(data.values().next().value!)).toMatchObject({ version: 2, minReaderVersion: 1, extra: '保留', content: { future: { value: 1 } } })
  })
  it('面板未知、重复、悬空引用与系统浮窗均在 Dockview 前拒绝', () => {
    const valid = layout()
    const parse = (value: unknown) => parseWorkspaceDockLayout(JSON.stringify(value), [{ id: 'preview' }])
    expect(() => parse({ ...valid, popoutGroups: [] })).toThrow()
    expect(() => parse({ ...valid, edgeGroups: [] })).toThrow()
    expect(() => parse({ ...valid, panels: { other: { id: 'other', contentComponent: 'other' } } })).toThrow()
    expect(() => parse({ ...valid, panels: {} })).toThrow()
    const duplicate = layout()
    if (Array.isArray(duplicate.grid.root.data)) duplicate.grid.root.data.push(duplicate.grid.root.data[0])
    expect(() => parse(duplicate)).toThrow()
    expect(parse(valid).panels.preview.id).toBe('preview')
  })
})
