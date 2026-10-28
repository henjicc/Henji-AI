import vm from 'node:vm'
import { MessageChannel } from 'node:worker_threads'
import { createRequire } from 'node:module'
import path from 'node:path'
import { rollup } from 'rollup'
import { expect, it, vi } from 'vitest'
import { replayMainWorld } from '../../../../scripts/vite/replayMainWorld'

const { JSDOM } = createRequire(path.resolve('package.json'))('jsdom') as {
  JSDOM: new (html: string, options: Record<string, unknown>) => { window: { eval(code: string): unknown; close(): void } }
}

it('打包函数序列化后独立安装页面时钟、帧控制和最小宿主桥', async () => {
  const bundle = await rollup({ input: 'virtual:henji-replay-main-world', plugins: [replayMainWorld()] })
  const { output } = await bundle.generate({ format: 'cjs' })
  await bundle.close()
  const chunk = output.find(item => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('缺少重演主世界产物')
  const isolated = { module: { exports: undefined as unknown } }
  vm.runInNewContext(chunk.code, isolated)
  const install = isolated.module.exports as (host: unknown) => void
  expect(typeof install).toBe('function')
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://replay.test/', runScripts: 'outside-only', pretendToBeVisual: true })
  const channels: MessageChannel[] = []
  const report = vi.fn()
  const host = { boot: { wallAtZeroMs: 123456, random: { math: [0.25], uuid: [], bytes: [] }, clipboard: [], callbacks: [], locator: {}, pointer: false }, http: vi.fn(), invoke: vi.fn(), report }
  Object.assign(dom.window, { fetch, Headers, Response, Request,
    MessageChannel: class extends MessageChannel { constructor() { super(); channels.push(this) } },
  })
  try {
    // jsdom 不实现 Web Animations；这里只补平台空场景，时钟与重演逻辑使用正式产物。
    dom.window.eval(`window.Animation = class { get playbackRate() { return 1 } set playbackRate(v) {} get currentTime() { return 0 } set currentTime(v) {} finish() {} }; document.getAnimations = () => []; document.adoptedStyleSheets = []; CSSStyleSheet.prototype.replaceSync = function() {};`)
    const installInPage = dom.window.eval(`(${install.toString()})`) as (host: unknown) => void
    installInPage(host)
    expect(dom.window.eval('typeof henjiReplayHost')).toBe('undefined')
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' }))
    expect(dom.window.eval('Math.random()')).toBe(0.25)
    expect(dom.window.eval('typeof require')).toBe('undefined')
    expect(dom.window.eval('typeof process')).toBe('undefined')
    dom.window.eval('window.fired = false; setTimeout(() => { window.fired = true }, 10)')
    expect(dom.window.eval('window.fired')).toBe(false)
    await dom.window.eval('__HENJI_WEB_REPLAY_CONTROL__.advance(performance.now() + 20)')
    expect(dom.window.eval('window.fired')).toBe(true)
    expect(dom.window.eval('Date.now() - Math.floor(performance.now())')).toBe(123456)
    expect(dom.window.eval('typeof __HENJI_WEB_REPLAY_CONTROL__.frame')).toBe('function')
    expect(dom.window.eval('typeof __HENJI_WEB_REPLAY_CONTROL__.repaintToken')).toBe('function')
  } finally {
    channels.forEach(channel => { channel.port1.close(); channel.port2.close() })
    dom.window.close()
  }
})
