import { vi } from 'vitest'

/** jsdom 中模拟主进程放行的同源 about:blank 子窗口：独立 Document，事件可派发。 */
export function createPopoutTestHost(options: { href?: string; deny?: boolean } = {}) {
  const opened: { name: string; features: string; child: ReturnType<typeof createChild> }[] = []
  function createChild() {
    const document = window.document.implementation.createHTMLDocument('')
    const events = new EventTarget()
    const child = {
      document,
      location: { href: options.href ?? 'about:blank' },
      closed: false,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      focus: vi.fn(),
      close: vi.fn(() => { if (child.closed) return; child.closed = true; events.dispatchEvent(new Event('pagehide')) }),
      /** 模拟用户点系统标题栏关闭按钮。 */
      userClose: () => { child.closed = true; events.dispatchEvent(new Event('pagehide')) },
      screenX: 2760, screenY: 200, outerWidth: 480, outerHeight: 360,
      screen: { availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1040 },
      moveTo: vi.fn((x: number, y: number) => { child.screenX = x; child.screenY = y }),
      resizeTo: vi.fn((width: number, height: number) => { child.outerWidth = width; child.outerHeight = height }),
    }
    return child
  }
  const open = (_url: string, name: string, features: string) => {
    if (options.deny) return null
    const child = createChild(); opened.push({ name, features, child }); return child
  }
  const host = new Proxy(window, {
    get(target, key) {
      if (key === 'open') return open
      const value = Reflect.get(target, key) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  return { host, opened, open }
}
