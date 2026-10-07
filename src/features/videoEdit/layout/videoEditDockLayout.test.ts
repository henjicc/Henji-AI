// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDockview, type DockviewApi } from 'dockview-react'
import { defaultVideoEditLayout, dockVideoEditGroup, dockVideoEditPanel, parseVideoEditLayout, resetVideoEditLayout, restoreVideoEditLayout, saveVideoEditLayout, showVideoEditPanel, VIDEO_EDIT_LAYOUT_STORAGE_KEY } from './videoEditDockLayout'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
let api: DockviewApi
let host: HTMLDivElement
let created: Record<string, number>
let disposed: Record<string, number>

beforeEach(() => {
  localStorage.clear(); created = {}; disposed = {}
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  // Dockview's bounded floating overlay uses DOM geometry, which jsdom does not calculate.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 860))
  host = document.createElement('div'); document.body.append(host)
  api = createDockview(host, { disableAutoResizing: true, floatingGroupBounds: 'boundedWithinViewport', createComponent: ({ id }) => {
    created[id] = (created[id] ?? 0) + 1
    return { element: document.createElement('div'), init(): void {}, dispose(): void { disposed[id] = (disposed[id] ?? 0) + 1 } }
  } })
  api.layout(1440, 860)
})
afterEach(() => { api.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('剪辑面板布局', () => {
  it('布局移动、分组、浮动、贴回与重置保留节目组件，不重复创建预览', () => {
    resetVideoEditLayout(api)
    const program = api.getPanel('program')!
    const timeline = api.getPanel('timeline')!
    const effects = api.getPanel('effects')!
    expect(program.api.width).toBeGreaterThan(api.getPanel('project')!.api.width)
    expect(program.api.height).toBeGreaterThan(timeline.api.height)
    timeline.api.moveTo({ group: program.group, position: 'center' })
    expect(program.group.panels).toHaveLength(2)
    api.addFloatingGroup(program)
    expect(program.api.location.type).toBe('floating')
    dockVideoEditPanel(api, program)
    expect(program.api.location.type).toBe('grid')
    api.addFloatingGroup(effects.group)
    dockVideoEditGroup(api, effects.group)
    expect(effects.api.location.type).toBe('grid')
    program.api.maximize(); expect(program.api.isMaximized()).toBe(true)
    program.api.exitMaximized(); expect(program.api.isMaximized()).toBe(false)
    resetVideoEditLayout(api)
    expect(api.getPanel('program')).toBe(program)
    expect(api.getPanel('timeline')).toBe(timeline)
    expect(created.program).toBe(1)
    expect(disposed.program).toBeUndefined()
    expect(api.totalPanels).toBe(7)
    expect(api.groups).toHaveLength(4)
    expect(api.getPanel('style_kits')!.group).toBe(api.getPanel('effects')!.group)
  })

  it('保存并恢复关闭与浮动状态，全部关闭后仍能按单实例恢复', () => {
    resetVideoEditLayout(api)
    api.getPanel('timeline')!.api.close()
    api.addFloatingGroup(api.getPanel('effects')!)
    saveVideoEditLayout(api)
    const saved = localStorage.getItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY)!
    expect(parseVideoEditLayout(saved).panels.timeline).toBeUndefined()
    // 旧名称保存的布局恢复后改用当前面板名
    const renamed = JSON.parse(saved) as { panels: Record<string, { title?: string }> }
    renamed.panels.project.title = '项目素材'
    expect(parseVideoEditLayout(JSON.stringify(renamed)).panels.project.title).toBe('素材')
    restoreVideoEditLayout(api)
    expect(api.getPanel('timeline')).toBeUndefined()
    expect(api.getPanel('effects')!.api.location.type).toBe('floating')
    expect(created.program).toBe(1)
    api.closeAllGroups(); saveVideoEditLayout(api); restoreVideoEditLayout(api)
    expect(api.totalPanels).toBe(0)
    const restored = showVideoEditPanel(api, 'program')
    expect(showVideoEditPanel(api, 'program')).toBe(restored)
    expect(api.totalPanels).toBe(1)
  })

  it.each(['annotations', 'content', 'tracking', 'lumetri', 'title_templates', 'effects_library', 'style_kits'] as const)('%s 打开、重开及浮动贴回都作为检查器标签，不增加默认分组', id => {
    resetVideoEditLayout(api)
    const effects = api.getPanel('effects')!
    const assertGrouped = (): void => {
      expect(api.getPanel(id)!.group).toBe(effects.group)
      expect(api.groups).toHaveLength(4)
    }
    showVideoEditPanel(api, id); assertGrouped()
    api.getPanel(id)!.api.close()
    const panel = showVideoEditPanel(api, id); assertGrouped()
    api.addFloatingGroup(panel)
    dockVideoEditPanel(api, panel); assertGrouped()
    api.addFloatingGroup(panel)
    dockVideoEditGroup(api, panel.group); assertGrouped()
  })

  it('效果控件关闭后仍沿现有检查器组打开和贴回，恢复效果控件也不另开一列', () => {
    resetVideoEditLayout(api)
    const group = api.getPanel('title_templates')!.group
    api.getPanel('effects')!.api.close()
    api.getPanel('style_kits')!.api.close()
    const style = showVideoEditPanel(api, 'style_kits')
    expect(style.group).toBe(group)
    api.addFloatingGroup(style)
    dockVideoEditPanel(api, style)
    expect(style.group).toBe(group)
    expect(showVideoEditPanel(api, 'effects').group).toBe(group)
    expect(api.groups).toHaveLength(4)
  })

  it('浮动的时间线贴回时回到节目画面下方，不变成右侧窄竖列（5.8）', () => {
    resetVideoEditLayout(api)
    const program = api.getPanel('program')!
    const timeline = api.getPanel('timeline')!
    api.addFloatingGroup(timeline)
    dockVideoEditPanel(api, timeline)
    expect(timeline.api.location.type).toBe('grid')
    // 在下方：与节目画面同宽方向排布、比节目矮；贴到右边时会与节目画面并排、几乎等高
    expect(timeline.api.width).toBeGreaterThanOrEqual(program.api.width)
    expect(timeline.api.height).toBeLessThan(program.api.height + timeline.api.height)
    expect(timeline.group).not.toBe(program.group)
    api.addFloatingGroup(timeline.group)
    dockVideoEditGroup(api, timeline.group)
    expect(timeline.api.width).toBeGreaterThanOrEqual(program.api.width)
  })

  it('节目画面关闭或从浮窗贴回后回到时间线上方，时间线不变成整高窄列（5.8）', () => {
    resetVideoEditLayout(api)
    const timelineWidth = api.getPanel('timeline')!.api.width
    api.getPanel('program')!.api.close()
    const program = showVideoEditPanel(api, 'program')
    const timeline = api.getPanel('timeline')!
    expect(program.api.location.type).toBe('grid')
    expect(program.group).not.toBe(timeline.group)
    // 上下排布：两者同宽，时间线宽度不因节目画面回来而被挤窄
    expect(program.api.width).toBe(timeline.api.width)
    expect(timeline.api.width).toBe(timelineWidth)
  })

  it('只有浮动分组时仍可将面板和整组贴回主区域', () => {
    const program = showVideoEditPanel(api, 'program')
    api.addFloatingGroup(program)
    dockVideoEditPanel(api, program)
    expect(program.api.location.type).toBe('grid')
    api.addFloatingGroup(program.group)
    dockVideoEditGroup(api, program.group)
    expect(program.api.location.type).toBe('grid')
    expect(created.program).toBe(1)
  })

  it('损坏布局、重复节目视图及未知执行组件不会进入恢复流程', () => {
    const duplicate = defaultVideoEditLayout()
    duplicate.floatingGroups = [{ data: { id: 'duplicate', views: ['program'] }, position: { left: 0, top: 0, width: 400, height: 300 } }]
    expect(() => parseVideoEditLayout(JSON.stringify(duplicate))).toThrow('重复或缺失')
    const unknown = defaultVideoEditLayout(); unknown.panels.program.contentComponent = 'unregistered'
    expect(() => parseVideoEditLayout(JSON.stringify(unknown))).toThrow('无效的剪辑面板')
    const popout = defaultVideoEditLayout(); popout.popoutGroups = []
    expect(() => parseVideoEditLayout(JSON.stringify(popout))).toThrow('不支持')
    localStorage.setItem(VIDEO_EDIT_LAYOUT_STORAGE_KEY, '{broken')
    restoreVideoEditLayout(api)
    expect(api.totalPanels).toBe(7)
    expect(api.groups).toHaveLength(4)
    expect(created.program).toBe(1)
  })
})
