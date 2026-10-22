import { afterEach, describe, expect, it, vi } from 'vitest'
import { contributeAppMenus, subscribeAppMenus, findAppMenuCommand, getAppMenus, toElectronAccelerator, toNativeAppMenu } from './appMenu'

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()) })
const noop = (): void => undefined

describe('应用菜单登记表', () => {
  it('编辑语义随模型序列化，不暴露执行函数', () => {
    disposers.push(contributeAppMenus('edit-role', [{ menu: 'edit', items: [{ kind: 'action', id: 'test.undo', label: '撤销', editRole: 'undo', run: noop }] }]))
    expect(toNativeAppMenu()[0].submenu[0]).toMatchObject({ editRole: 'undo' })
    expect(toNativeAppMenu()[0].submenu[0]).not.toHaveProperty('run')
  })
  it('公共菜单在两端、工作区菜单在中间；同名菜单按分组顺序合并并自动加分隔线；撤回后消失', () => {
    disposers.push(contributeAppMenus('app', [
      { menu: 'help', items: [{ kind: 'action', id: 'app.about', label: '关于', run: noop }] },
      { menu: 'file', order: 90, items: [{ kind: 'action', id: 'app.settings', label: '设置…', run: noop }] },
    ]))
    const dispose = contributeAppMenus('videoEdit', [
      { menu: 'sequence', label: '序列', order: 100, items: [{ kind: 'action', id: 'videoEdit.newSequence', label: '新建序列', run: noop }] },
      { menu: 'file', order: 10, items: [{ kind: 'action', id: 'videoEdit.export', label: '导出…', run: noop }] },
    ])
    expect(getAppMenus().map(menu => menu.label)).toEqual(['文件', '序列', '帮助'])
    expect(getAppMenus()[0].items.map(item => item.kind === 'action' ? item.label : item.kind)).toEqual(['导出…', 'separator', '设置…'])
    expect(findAppMenuCommand('videoEdit.newSequence')?.label).toBe('新建序列')
    dispose()
    expect(getAppMenus().map(menu => menu.label)).toEqual(['文件', '帮助'])
    expect(findAppMenuCommand('videoEdit.newSequence')).toBeUndefined()
  })

  it('同一所有者重复声明是替换，不会叠加两份', () => {
    disposers.push(contributeAppMenus('audioEdit', [{ menu: 'edit', items: [{ kind: 'action', id: 'audioEdit.undo', label: '撤销', disabledReason: '没有可撤销的操作', run: noop }] }]))
    disposers.push(contributeAppMenus('audioEdit', [{ menu: 'edit', items: [{ kind: 'action', id: 'audioEdit.undo', label: '撤销', run: noop }] }]))
    expect(getAppMenus()).toHaveLength(1)
    expect(getAppMenus()[0].items).toHaveLength(1)
    expect(findAppMenuCommand('audioEdit.undo')?.disabledReason).toBeUndefined()
  })

  it('原生菜单模型去掉执行函数，快捷键换成 CmdOrCtrl，不可用即 enabled=false，勾选项为 checkbox', () => {
    disposers.push(contributeAppMenus('app', [{ menu: 'window', items: [
      { kind: 'action', id: 'app.assistant', label: '智能助手', checked: true, run: noop },
      { kind: 'separator' },
      { kind: 'submenu', id: 'layout', label: '工作区布局', items: [{ kind: 'action', id: 'layout.reset', label: '重置', shortcut: 'Ctrl+Shift+R', disabledReason: '当前布局没有调整', run: noop }] },
    ] }]))
    const [menu] = toNativeAppMenu()
    expect(menu).toEqual({ id: 'window', label: '窗口', submenu: [
      { type: 'checkbox', id: 'app.assistant', label: '智能助手', enabled: true, checked: true },
      { type: 'separator' },
      { type: 'submenu', id: 'layout', label: '工作区布局', enabled: true, submenu: [{ type: 'normal', id: 'layout.reset', label: '重置', accelerator: 'CmdOrCtrl+Shift+R', enabled: false }] },
    ] })
    expect(toElectronAccelerator('Delete')).toBe('Delete')
    expect(toElectronAccelerator('Ctrl+Shift+←')).toBe('CmdOrCtrl+Shift+Left')
    expect(toElectronAccelerator('PgDn')).toBe('PageDown')
  })
  it('子菜单禁用后，旧原生菜单回传的子命令同样不可执行', () => {
    disposers.push(contributeAppMenus('disabled-parent', [{ menu: 'file', items: [{ kind: 'submenu', id: 'export', label: '导出', disabledReason: '正在导出', items: [{ kind: 'action', id: 'export.png', label: 'PNG', run: noop }] }] }]))
    expect(findAppMenuCommand('export.png')?.disabledReason).toBe('正在导出')
  })
  it('撤回后立即以相同内容重新声明不通知菜单栏，菜单项执行最新一次声明的动作', async () => {
    const first = vi.fn(), second = vi.fn(), listener = vi.fn()
    const unsubscribe = subscribeAppMenus(listener)
    const dispose = contributeAppMenus('videoEdit', [{ menu: 'edit', items: [{ kind: 'action', id: 'videoEdit.split', label: '切割', run: first }] }])
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    const shown = getAppMenus()
    dispose()
    disposers.push(contributeAppMenus('videoEdit', [{ menu: 'edit', items: [{ kind: 'action', id: 'videoEdit.split', label: '切割', run: second }] }]))
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getAppMenus()).toBe(shown)
    void findAppMenuCommand('videoEdit.split')?.run()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    unsubscribe()
  })
})
