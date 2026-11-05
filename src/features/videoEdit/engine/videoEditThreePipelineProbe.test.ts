import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { setVideoEditGpuFaultObserver } from './videoEditGpuErrorScope'
import { guardVideoEditThree, observeThreeConsole, observeThreePipelines } from './videoEditThreePipelineProbe'

afterEach(() => { vi.restoreAllMocks() })
const device = { pushErrorScope() {}, popErrorScope: async () => null } as unknown as GpuDevice
function fakeRenderer(backendOverride: object = {}) {
  const data = new WeakMap<object, { error?: boolean; pipeline?: unknown }>()
  const get = (object: object): { error?: boolean; pipeline?: unknown } => { let value = data.get(object); if (!value) { value = {}; data.set(object, value) } return value }
  const pipeline = {}
  const renderObject = { pipeline, object: { name: 'logo', type: 'Mesh' }, material: { type: 'MeshPhysicalMaterial' } }
  const drawn = vi.fn()
  const backend = { isWebGPUBackend: true, get, draw(item: unknown) { drawn(item) }, createRenderPipeline(_item: unknown) {}, ...backendOverride }
  return { renderer: { backend }, backend, renderObject, pipeline, get, drawn }
}

it('本帧新建的管线建失败（three 把错误接走了）：守卫报出物体与材质', async () => {
  const { renderer, backend, renderObject, get, pipeline } = fakeRenderer()
  observeThreePipelines(renderer)
  const draw = guardVideoEditThree(renderer, device, '三维渲染', () => { backend.createRenderPipeline(renderObject); backend.draw(renderObject) })
  // three 在作用域弹出后的回调里才设标记。
  get(pipeline).error = true
  await expect(draw).rejects.toThrow('三维渲染失败：物体“logo”的MeshPhysicalMaterial的着色管线无法创建，未画出。')
})

it('之后每帧 three 静默跳过绘制：守卫同样报失败，不会时好时坏', async () => {
  const { renderer, backend, renderObject, get, pipeline, drawn } = fakeRenderer()
  observeThreePipelines(renderer)
  get(pipeline).error = true
  for (let frame = 0; frame < 2; frame++) {
    await expect(guardVideoEditThree(renderer, device, '三维渲染', () => { backend.draw(renderObject) })).rejects.toThrow('着色管线无法创建')
  }
  expect(drawn).toHaveBeenCalledTimes(2)
})

it('管线正常时不报错，守卫的结果照常返回', async () => {
  const { renderer, backend, renderObject } = fakeRenderer()
  observeThreePipelines(renderer)
  await expect(guardVideoEditThree(renderer, device, '三维渲染', () => { backend.draw(renderObject); return 7 })).resolves.toBe(7)
})

it('管线失败比守卫的泛化错误更具体，盖过它', async () => {
  const { renderer, backend, renderObject, get, pipeline } = fakeRenderer()
  observeThreePipelines(renderer)
  const failing = { pushErrorScope() {}, popErrorScope: async () => ({ message: 'Invalid RenderPipeline' }) } as unknown as GpuDevice
  get(pipeline).error = true
  await expect(guardVideoEditThree(renderer, failing, '三维渲染', () => { backend.createRenderPipeline(renderObject) })).rejects.toThrow('物体“logo”')
})

it('预热时别处的错误落进 three 的作用域：拿到了管线就不算失败；真失败（管线留空）照样报', async () => {
  const { renderer, backend, renderObject, get, pipeline } = fakeRenderer({
    createRenderPipeline(_item: unknown, promises: Array<Promise<unknown>> | null) {
      promises?.push(Promise.resolve().then(() => { const data = (renderer.backend as unknown as { get(object: object): { error?: boolean; pipeline?: unknown } }).get(pipeline); data.error = true; if (compiled) data.pipeline = compiled }))
    },
  })
  let compiled: object | undefined = {}
  observeThreePipelines(renderer)
  const promises: Array<Promise<unknown>> = []
  ;(backend.createRenderPipeline as (item: unknown, list: Array<Promise<unknown>> | null) => void)(renderObject, promises)
  await Promise.all(promises)
  expect(get(pipeline).error).toBe(false)
  await expect(guardVideoEditThree(renderer, device, '三维渲染', () => { backend.draw(renderObject) })).resolves.toBeUndefined()
  compiled = undefined; get(pipeline).pipeline = undefined
  const again: Array<Promise<unknown>> = []
  ;(backend.createRenderPipeline as (item: unknown, list: Array<Promise<unknown>> | null) => void)(renderObject, again)
  await Promise.all(again)
  expect(get(pipeline).error).toBe(true)
  await expect(guardVideoEditThree(renderer, device, '三维渲染', () => { backend.draw(renderObject) })).rejects.toThrow('着色管线无法创建')
})

it('WebGL 后端与缺方法的版本不安装', () => {
  const webgl = fakeRenderer({ isWebGPUBackend: false })
  const draw = webgl.backend.draw
  observeThreePipelines(webgl.renderer)
  expect(webgl.backend.draw).toBe(draw)
  const old = fakeRenderer({ createRenderPipeline: undefined })
  const oldDraw = old.backend.draw
  observeThreePipelines(old.renderer)
  expect(old.backend.draw).toBe(oldDraw)
})

it('three 的管线错误原文进日志，其他输出照旧转给原来的函数', () => {
  const report = vi.fn(); const stop = setVideoEditGpuFaultObserver(report)
  const previous = vi.fn()
  const library: { console: ((type: string, message: string) => void) | null; setConsoleFunction(fn: (type: string, message: string) => void): void; getConsoleFunction(): unknown } = {
    console: previous,
    setConsoleFunction(fn) { this.console = fn },
    getConsoleFunction() { return this.console },
  }
  try {
    observeThreeConsole(library); const installed = library.console
    observeThreeConsole(library)
    expect(library.console).toBe(installed)
    library.console!('error', 'WebGPURenderer: Render pipeline creation failed (mesh): bad blend')
    library.console!('warn', '无关的警告')
    expect(report).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith('video_edit.three.pipeline.failed', 'WebGPURenderer: Render pipeline creation failed (mesh): bad blend', undefined)
    expect(previous).toHaveBeenCalledTimes(2)
  } finally { stop() }
})

// 显式 GPU 专项：隔离 Chrome，用真实 three 与真实显卡。测试设备没有开启 float32-blendable，浮点目标加混合必然校验失败。
if (process.env.HENJI_THREE_GPU === '1') it('真实 three：混合写浮点目标的管线建失败，每帧都报失败并点名物体', async () => {
  const { build } = await import('esbuild')
  const { chromium } = await import('playwright')
  const { createServer } = await import('node:http')
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const bundled = await build({ stdin: { contents: "export * from './src/features/videoEdit/engine/videoEditThreePipelineProbe'", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, alias: { '@': path.resolve('src') }, define: { 'import.meta.env': '{}' }, external: ['three', 'three/webgpu'], logLevel: 'silent' })
  const server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url!, 'http://localhost').pathname
      response.setHeader('Content-Type', name === '/' ? 'text/html' : 'text/javascript')
      if (name === '/') response.end('<html><head><script type="importmap">{"imports":{"three":"/three.module.js","three/webgpu":"/three.webgpu.js","three/tsl":"/three.tsl.js"}}</script></head><body></body></html>')
      else if (name === '/probe.js') response.end(bundled.outputFiles[0].text)
      else if (/^\/three\.(?:webgpu|core|tsl|module)\.js$/.test(name)) response.end(await readFile(path.resolve('node_modules/henji-author-three-0.186.1/build', name.slice(1))))
      else { response.statusCode = 404; response.end() }
    } catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`)
    const evidence = await page.evaluate<{ blendable: boolean; healthy: string; frames: string[]; raw: string[] }>(`(async () => {
      const THREE = await import('/three.webgpu.js'); const probe = await import('/probe.js');
      const raw = []; probe.observeThreeConsole(THREE);
      const previous = THREE.getConsoleFunction(); THREE.setConsoleFunction((type, message, ...rest) => { if (type === 'error') raw.push(String(message)); previous(type, message, ...rest) });
      const adapter = await navigator.gpu.requestAdapter(); const device = await adapter.requestDevice();
      const renderer = new THREE.WebGPURenderer({ canvas: new OffscreenCanvas(4, 4), device }); await renderer.init(); probe.observeThreePipelines(renderer);
      const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(50, 1, .1, 10); camera.position.z = 2;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: .5 })); mesh.name = 'float-panel'; scene.add(mesh);
      const healthyTarget = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType }); const target = new THREE.RenderTarget(4, 4, { type: THREE.FloatType });
      const frame = async t => { try { await probe.guardVideoEditThree(renderer, device, '三维渲染', () => { renderer.setRenderTarget(t); renderer.render(scene, camera); renderer.setRenderTarget(null) }); return 'ok' } catch (error) { return error.message } };
      const healthy = await frame(healthyTarget);
      const frames = [await frame(target), await frame(target)];
      return { blendable: device.features.has('float32-blendable'), healthy, frames, raw };
    })()`)
    expect(evidence.blendable).toBe(false)
    expect(evidence.healthy).toBe('ok')
    for (const message of evidence.frames) expect(message).toContain('物体“float-panel”')
    expect(evidence.raw.join('\n')).toMatch(/pipeline creation failed/i)
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
}, 120000)
