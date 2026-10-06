// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openVideoEditPopoutWindow } from './videoEditPopoutWindow'
import { createPopoutTestHost } from './videoEditPopout.testSupport'

const options = (patch: Partial<Parameters<typeof openVideoEditPopoutWindow>[1]> = {}) => ({ title: '效果控件 - 痕迹AI', size: { width: 100, height: 900 }, onClosed: vi.fn(), onVisibilityChange: vi.fn(), ...patch })

afterEach(() => {
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-theme-tone')
  document.documentElement.removeAttribute('style')
})

it('以受控名称打开空白子窗，复制主题样式与根属性，并随主窗口主题变化同步', async () => {
  document.head.innerHTML = '<style id="tokens">:root{--bg-rgb:1 2 3}</style><link rel="stylesheet" href="./assets/app.css">'
  document.documentElement.setAttribute('data-theme-tone', 'cool')
  document.documentElement.style.setProperty('--accent-rgb', '1 2 3')
  const { host, opened } = createPopoutTestHost()
  const popout = openVideoEditPopoutWindow('effects', options(), host)!
  expect(opened).toHaveLength(1)
  expect(opened[0].name).toBe('henji-video-edit-popout:effects')
  expect(opened[0].features).toBe(`popup,width=320,height=900,henjiTitle=${encodeURIComponent('效果控件 - 痕迹AI')}`)
  const child = opened[0].child.document
  expect(child.title).toBe('效果控件 - 痕迹AI')
  expect(child.getElementById('tokens')?.textContent).toContain('--bg-rgb')
  expect(child.querySelector('link')?.getAttribute('href')).toBe(new URL('./assets/app.css', document.baseURI).href)
  expect(child.documentElement.getAttribute('data-theme-tone')).toBe('cool')
  expect(popout.container.ownerDocument).toBe(child)
  // 首批样式表加载前隐藏内容，加载（或失败）后显示。
  expect(popout.container.style.visibility).toBe('hidden')
  child.querySelector('link')!.dispatchEvent(new Event('load'))
  expect(popout.container.style.visibility).toBe('')
  const linkClone = child.querySelector('link')

  document.documentElement.setAttribute('data-theme-tone', 'warm')
  document.documentElement.style.setProperty('--accent-rgb', '9 9 9')
  document.head.querySelector('style')!.textContent = ':root{--bg-rgb:7 7 7}'
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(child.documentElement.getAttribute('data-theme-tone')).toBe('warm')
  expect(child.documentElement.getAttribute('style')).toContain('9 9 9')
  expect(child.querySelectorAll('#tokens')).toHaveLength(1)
  expect(child.getElementById('tokens')?.textContent).toContain('7 7 7')
  // 增量同步：已加载的样式表不被重建；新增与删除的样式就地跟随。
  expect(child.querySelector('link')).toBe(linkClone)
  const injected = document.createElement('style'); injected.id = 'injected'; injected.textContent = '.x{}'
  document.head.appendChild(injected)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(child.getElementById('injected')).not.toBeNull()
  injected.remove()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(child.getElementById('injected')).toBeNull()
  expect(child.querySelector('link')).toBe(linkClone)
})

it('用户关闭与主动关闭都只通知一次，关闭后不再同步', async () => {
  const { host, opened } = createPopoutTestHost()
  const userClosed = options()
  openVideoEditPopoutWindow('timeline', userClosed, host)
  opened[0].child.userClose(); opened[0].child.userClose()
  expect(userClosed.onClosed).toHaveBeenCalledOnce()

  const manual = options()
  const popout = openVideoEditPopoutWindow('project', manual, host)!
  popout.close(); popout.close()
  expect(manual.onClosed).toHaveBeenCalledOnce()
  expect(opened[1].child.close).toHaveBeenCalledOnce()
  document.documentElement.setAttribute('data-theme-tone', 'warm')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(opened[1].child.document.documentElement.hasAttribute('data-theme-tone')).toBe(false)
})

it('主进程拒绝或子窗不是受控空白页时不建立浮窗', () => {
  expect(openVideoEditPopoutWindow('effects', options(), createPopoutTestHost({ deny: true }).host)).toBeNull()
  const foreign = createPopoutTestHost({ href: 'https://example.com/' })
  expect(openVideoEditPopoutWindow('effects', options(), foreign.host)).toBeNull()
  expect(foreign.opened[0].child.close).toHaveBeenCalledOnce()
})

it('焦点不留在子窗 body：初次打开、输入框失焦和窗口重新获得焦点时收回到可聚焦容器，不抢正在编辑的输入框', () => {
  vi.useFakeTimers()
  const frame = document.createElement('iframe'); document.body.append(frame)
  const popoutWindow = frame.contentWindow!
  const host = new Proxy(window, { get: (target, key) => key === 'open' ? () => popoutWindow : (typeof Reflect.get(target, key) === 'function' ? (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target) : Reflect.get(target, key)) })
  const popout = openVideoEditPopoutWindow('effects', options(), host)!
  const child = popoutWindow.document
  expect(popout.container.tabIndex).toBe(-1)
  expect(child.activeElement).toBe(popout.container)
  const input = child.createElement('input'); popout.container.append(input)
  input.focus()
  vi.advanceTimersByTime(10)
  expect(child.activeElement).toBe(input)
  input.blur()
  expect(child.activeElement).toBe(child.body)
  vi.advanceTimersByTime(10)
  expect(child.activeElement).toBe(popout.container)
  ;(child.activeElement as HTMLElement).blur()
  popoutWindow.dispatchEvent(new Event('focus'))
  expect(child.activeElement).toBe(popout.container)
  popout.close(); frame.remove(); vi.useRealTimers()
})

it('无系统边框窗口：桌面端几何交给主进程代管；兜底路径用 moveTo/resizeTo 跟随、收起、模拟最大化并在拖动时先还原', () => {
  const { host, opened } = createPopoutTestHost()
  const control = vi.fn()
  const native = openVideoEditPopoutWindow('effects', options({ control }), host)!
  native.beginMove({ x: 10, y: 20 }); native.moveWith({ x: 30, y: 40 }); native.setCollapsed(true); native.endMove(); native.toggleMaximized()
  expect(control.mock.calls.map(([request]) => request)).toEqual([
    { action: 'begin-move', x: 10, y: 20 }, { action: 'move', x: 30, y: 40 }, { action: 'collapse' }, { action: 'end-move' }, { action: 'toggle-maximize' },
  ])
  expect(opened[0].child.moveTo).not.toHaveBeenCalled()
  native.close()

  const popout = openVideoEditPopoutWindow('effects', options(), host)!
  const child = opened[1].child
  // 抓在 (2900,210)，窗口 (2760,200,480,360)：跟随指针移动。
  popout.beginMove({ x: 2900, y: 210 }); popout.moveWith({ x: 3000, y: 260 })
  expect(child.moveTo).toHaveBeenLastCalledWith(2860, 250)
  popout.setCollapsed(true)
  expect(child.resizeTo).toHaveBeenLastCalledWith(480, 32)
  popout.endMove()
  expect(child.resizeTo).toHaveBeenLastCalledWith(480, 360)
  // 双击最大化：铺满所在显示器可用区域；记录位置时用还原外框。
  popout.toggleMaximized()
  expect(child.moveTo).toHaveBeenLastCalledWith(2560, 0)
  expect(child.resizeTo).toHaveBeenLastCalledWith(1920, 1040)
  expect(popout.readBounds()).toEqual({ x: 2860, y: 250, width: 480, height: 360 })
  // 最大化时拖动：先还原，指针保持在标题栏同样的相对横向位置（中点）。
  popout.beginMove({ x: 3520, y: 10 })
  expect(child.resizeTo).toHaveBeenLastCalledWith(480, 360)
  expect(child.moveTo).toHaveBeenLastCalledWith(3280, 0)
  popout.endMove()
  popout.close()
})
