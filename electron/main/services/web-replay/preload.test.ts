import vm from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, expect, it, vi } from 'vitest'

let preload = ''
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['electron/preload/web-replay.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron', 'virtual:henji-replay-main-world', './web-replay-reader'] })
  preload = bundle.outputFiles[0].text
})

function run(phase: 'app' | 'reader', fail = false) {
  const send = vi.fn()
  const expose = vi.fn()
  const install = vi.fn(() => { if (fail) throw new Error('fixture injection') })
  const execute = vi.fn((script: { func: (...args: unknown[]) => void; args: unknown[] }) => script.func(...script.args))
  const electron = { contextBridge: { exposeInMainWorld: expose, executeInMainWorld: execute }, ipcRenderer: { send, sendSync: () => ({ phase, boot: {} }), invoke: vi.fn() } }
  vm.runInNewContext(preload, {
    TextDecoder, TextEncoder,
    location: { href: 'https://replay.test/' },
    require: (name: string) => {
      if (name === 'electron') return electron
      if (name === 'virtual:henji-replay-main-world') return install
      if (name === './web-replay-reader') return { installReplayReader: install }
      throw new Error(`意外 preload 依赖 ${name}`)
    },
  })
  return { send, expose, execute, install }
}

it('宿主桥仅传给安装函数，不挂在页面全局', () => {
  const { execute, expose, install } = run('app')
  expect(expose).not.toHaveBeenCalled()
  expect(execute.mock.calls[0][0].args).toHaveLength(1)
  expect(install).toHaveBeenCalledWith(expect.objectContaining({ boot: {}, http: expect.any(Function), invoke: expect.any(Function), report: expect.any(Function) }))
})

it('主世界注入失败立即报告原因', () => {
  const { send } = run('app', true)
  expect(send).toHaveBeenCalledWith('web-replay:report', { kind: 'failed', message: '重演运行时注入失败：Error: fixture injection' })
})

it('GPU 读取器安装失败立即通知主进程', () => {
  const { send } = run('reader', true)
  expect(send).toHaveBeenCalledWith('web-replay:reader-ready', { ok: false, error: '重演取帧运行时注入失败：Error: fixture injection' })
})
