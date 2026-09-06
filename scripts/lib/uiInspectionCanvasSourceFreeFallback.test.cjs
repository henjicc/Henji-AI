const assert = require('node:assert/strict')
const test = require('node:test')
const { createSourceFreeFallbackScene, inspectFallbackPixels, pixelsMatch, isCurrentCpuFrame, readFrame,
  DIAGNOSTIC_WARN_EVENTS } = require('./uiInspectionCanvasSourceFreeFallback.cjs')

function pixels(kind) {
  const output = new Uint8Array(128 * 96 * 4)
  for (let y = 0; y < 96; y += 1) for (let x = 0; x < 128; x += 1) {
    const gray = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 30 : 50
    const color = kind === 'transparent' ? [gray, gray, gray] : kind === 'black' ? [0, 0, 0]
      : kind === 'both' && x > 48 && x < 80 && y > 32 && y < 64 ? [230, 100, 30] : [30, 120, 210]
    output.set([...color, 255], (y * 128 + x) * 4)
  }
  return output
}

test('透明需真实棋盘且没有旧蓝/橙，黑屏或旧图不能伪通过；只恢复蓝底不能出现旧橙层', () => {
  for (const mode of ['both', 'transparent', 'blue']) assert.equal(pixelsMatch(inspectFallbackPixels(pixels(mode)), mode), true)
  for (const stale of ['both', 'blue', 'black']) assert.equal(pixelsMatch(inspectFallbackPixels(pixels(stale)), 'transparent'), false)
  assert.equal(pixelsMatch(inspectFallbackPixels(pixels('both')), 'blue'), false)
  assert.throws(() => inspectFallbackPixels(new Uint8Array(0)), /尺寸无效/)
})

test('全隐藏必须已呈现同revision新CPU帧，不接受只有状态旗标或隐藏GPU上的旧安全帧', () => {
  const state = { revision: 2, composition: 'cpu', presentation: 'canvas2d', gpuVisibility: 'hidden',
    frontVisibility: 'visible', coverage: 1, frameGeneration: 3, requestGeneration: 3, diagnostics: [] }
  assert.equal(isCurrentCpuFrame(state, 2, 2), true)
  for (const wrong of [{ revision: 1 }, { composition: 'gpu' }, { presentation: 'webgpu-surface' },
    { gpuVisibility: 'visible' }, { frontVisibility: 'hidden' }, { coverage: 0 },
    { requestGeneration: 4 }, { frameGeneration: 2 }, { diagnostics: ['没有可规划资源'] }]) {
    assert.equal(isCurrentCpuFrame({ ...state, ...wrong }, 2, 2), false)
  }
})

test('CPU alpha读取以实际Canvas backing比例映射文档区域，不误把整个stage当文档', async (t) => {
  let sampled
  class Canvas {
    width = 1000; height = 600
    getBoundingClientRect() { return { left: 100, top: 40, width: 500, height: 300 } }
    getAttribute() { return '3' }
    getContext() { return { getImageData: (x, y, width, height) => {
      sampled = { x, y, width, height }
      const data = new Uint8ClampedArray(width * height * 4)
      data[3] = 255
      return { data }
    } } }
  }
  const oldCanvas = globalThis.HTMLCanvasElement; const oldStyle = globalThis.getComputedStyle
  globalThis.HTMLCanvasElement = Canvas
  globalThis.getComputedStyle = (element) => ({ visibility: element instanceof Canvas ? 'visible' : 'hidden' })
  t.after(() => {
    if (oldCanvas === undefined) delete globalThis.HTMLCanvasElement; else globalThis.HTMLCanvasElement = oldCanvas
    if (oldStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = oldStyle
  })
  const front = new Canvas()
  const preview = { getAttribute: (name) => ({ 'data-preview-composition-backend': 'cpu',
    'data-preview-presentation-backend': 'canvas2d', 'data-preview-coverage': '1', 'data-preview-render-generation': '3' })[name],
  querySelectorAll: () => [] }
  const root = { querySelector: (selector) => ({ '[data-preview-surface]': preview,
    '[data-presentation-front-surface]': front, '[data-presentation-gpu-surface]': {},
    '[data-command-bar]': { getAttribute: () => '2' },
    '[data-document-transparency-grid]': { getBoundingClientRect: () => ({ left: 225, top: 100, right: 385, bottom: 220 }) },
  })[selector] }
  const state = await readFrame({ evaluate: (callback, input) => callback(root, input) }, true)
  assert.deepEqual(sampled, { x: 250, y: 120, width: 320, height: 240 })
  assert.equal(state.sampledPixels, 320 * 240)
  assert.equal(state.nontransparentPixels, 1, '真实残留像素不能被当作透明')
})

test('注册独立真实画布场景，保留正式故障注入/显隐/落盘/关闭重开入口，不开启初始化失败环境', () => {
  const scene = createSourceFreeFallbackScene({})
  assert.equal(scene.id, 'canvas-gpu-sourcefree-fallback')
  assert.equal(scene.surface, '画布')
  assert.equal(scene.writesUserData, true)
  assert.equal(scene.forceGpuInitializationFailure, undefined)
  const source = String(scene.setup)
  for (const marker of ['henji:image-editor-gpu-scene-diagnostic', "recovery: 'failure'", "waitPixels('transparent')",
    'nontransparentPixels === 0', 'toggle(\'reality-gpu-source-layer\', true)', 'dialog.waitFor',
    'sourceFingerprint', 'resourceRefs', 'gpu-reopened-blue', "event.level === 'error'"]) assert.ok(source.includes(marker), marker)
  assert.deepEqual(DIAGNOSTIC_WARN_EVENTS, ['image_editor_v3.gpu_scene.device_lost',
    'image_editor_v3.gpu_scene.fallback', 'image_editor_v3.gpu_scene.failed'])
})
