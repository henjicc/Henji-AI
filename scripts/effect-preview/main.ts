/**
 * 发光效果预览：素材画进 1920×1080 纹理，交给剪辑的正式内置效果执行器，结果叠到所选底色上显示。
 * 参数面板直接由效果登记生成，界面上调的就是软件里的同一组参数。
 */
import { videoEditBuiltinDefaults, videoEditBuiltinEffect, type VideoEditBuiltinEffectDefinition, type VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { VideoEditBuiltinEffectsGpu } from '@/features/videoEdit/engine/videoEditBuiltinEffectsGpu'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

const W = 1920; const H = 1080
/** 预览页能选的效果。 */
const PREVIEW_EFFECTS = ['glow', 'chromatic_aberration']
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const adapter = await navigator.gpu?.requestAdapter()
if (!adapter) { document.body.textContent = '这个浏览器没有 WebGPU。'; throw new Error('no webgpu') }
const device = await adapter.requestDevice()
const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
const effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, sampler as never, {
  allocate: (width, height, format) => device.createTexture({ size: [width, height], format: format as GPUTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST }) as unknown as GpuTexture,
  release: texture => (texture as unknown as GPUTexture).destroy(),
})
const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
const input = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage })
const output = device.createTexture({ size: [W, H], format: 'rgba8unorm', usage })

const canvas = $<HTMLCanvasElement>('canvas')
const context = canvas.getContext('webgpu')!
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })
const display = device.createShaderModule({ code: `
struct P { backdrop: vec4f, split: vec4f }
@group(0) @binding(0) var effect: texture_2d<f32>;
@group(0) @binding(1) var original: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: P;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
 let q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i]; return vec4f(q, 0, 1);
}
fn linear(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
 let at = vec2i(position.xy);
 let c = select(textureLoad(effect, at, 0), textureLoad(original, at, 0), position.x < p.split.x);
 // 预乘的 sRGB 编码值按普通合成叠到底色上（与剪辑合成器一致），再交给 sRGB 画布。
 let encoded = c.rgb + p.backdrop.rgb * (1.0 - c.a);
 return vec4f(${format.endsWith('-srgb') ? 'linear(encoded)' : 'encoded'}, 1.0);
}` })
const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: display, entryPoint: 'vs' }, fragment: { module: display, entryPoint: 'fs', targets: [{ format }] } })
const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

// ---- 素材
function backdropSrgb(): number[] { return $<HTMLSelectElement>('backdrop').value.split(',').map(Number) }
function neonTitle(ctx: OffscreenCanvasRenderingContext2D): void {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'; ctx.font = '700 220px "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif'; ctx.fillText('痕迹 AI', W / 2, H / 2 - 90)
  ctx.fillStyle = '#4fd1ff'; ctx.font = '700 72px "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif'; ctx.fillText('LIGHT  ·  发光测试', W / 2, H / 2 + 110)
  ctx.lineWidth = 6; ctx.strokeStyle = '#ff3b6b'; ctx.beginPath(); ctx.moveTo(560, 820); ctx.lineTo(1360, 820); ctx.stroke()
  ctx.lineWidth = 3; ctx.strokeStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(330, 300, 90, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 2; ctx.strokeStyle = '#8affc1'; ctx.strokeRect(1480, 220, 220, 140)
}
function nightScene(ctx: OffscreenCanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#05070d'); sky.addColorStop(1, '#1a1c26'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(1550, 220, 70, 0, Math.PI * 2); ctx.fill()
  let seed = 7; const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let row = 0; row < 7; row++) {
    const y = 560 + row * 62
    ctx.fillStyle = `rgb(${18 + row * 4},${20 + row * 4},${28 + row * 4})`; ctx.fillRect(0, y - 40, W, 80)
    for (let i = 0; i < 70; i++) {
      const x = random() * W; const hue = random()
      ctx.fillStyle = hue < 0.5 ? '#ffd9a0' : hue < 0.7 ? '#ffffff' : hue < 0.85 ? '#7fd4ff' : '#ff6a6a'
      ctx.fillRect(Math.round(x), Math.round(y - 30 + random() * 50), 3 + Math.round(random() * 3), 3 + Math.round(random() * 3))
    }
  }
  ctx.lineCap = 'round'
  ctx.lineWidth = 10; ctx.strokeStyle = '#ff2d55'; ctx.beginPath(); ctx.moveTo(220, 330); ctx.lineTo(620, 330); ctx.stroke()
  ctx.strokeStyle = '#2d8cff'; ctx.beginPath(); ctx.arc(900, 320, 110, Math.PI * 0.1, Math.PI * 1.6); ctx.stroke()
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, 1000); ctx.lineTo(W, 1000); ctx.stroke()
  ctx.fillStyle = '#6c707c'; ctx.font = '600 44px "Microsoft YaHei", sans-serif'; ctx.fillText('不够亮的文字不发光', 220, 470)
}
let photo: ImageBitmap | undefined
const samples: Record<string, { name: string; params: Partial<VideoEditBuiltinParams>; draw(ctx: OffscreenCanvasRenderingContext2D): void }> = {
  title: { name: '透明底文字', params: { threshold: 0 }, draw: neonTitle },
  night: { name: '夜景灯光', params: { threshold: 60 }, draw: nightScene },
  photo: { name: '拖入的图片', params: { threshold: 60 }, draw: ctx => { if (photo) { const s = Math.max(W / photo.width, H / photo.height); ctx.drawImage(photo, (W - photo.width * s) / 2, (H - photo.height * s) / 2, photo.width * s, photo.height * s) } } },
}
const sampleSelect = $<HTMLSelectElement>('sample')
for (const [key, sample] of Object.entries(samples)) sampleSelect.add(new Option(sample.name, key))

function loadSample(): void {
  const raster = new OffscreenCanvas(W, H); const ctx = raster.getContext('2d')!
  samples[sampleSelect.value].draw(ctx)
  device.queue.copyExternalImageToTexture({ source: raster }, { texture: input, premultipliedAlpha: true }, [W, H])
}

// ---- 参数面板（由效果登记生成）
const effectSelect = $<HTMLSelectElement>('effect')
for (const id of PREVIEW_EFFECTS) effectSelect.add(new Option(videoEditBuiltinEffect(id)!.name, id))
const definition = (): VideoEditBuiltinEffectDefinition => videoEditBuiltinEffect(effectSelect.value)!
const params: VideoEditBuiltinParams = {}
const side = $('side'); const refresh: Array<() => void> = []
/** 换素材或恢复默认时，只套用当前效果有的素材参数（透明底文字的阈值为 0）。 */
function resetParams(): void {
  for (const key of Object.keys(params)) delete params[key]
  const sample = samples[sampleSelect.value].params
  Object.assign(params, videoEditBuiltinDefaults(definition()), Object.fromEntries(Object.entries(sample).filter(([key]) => definition().params.some(param => param.key === key))))
  refresh.forEach(update => update())
}
function buildPanel(): void {
  side.replaceChildren(); refresh.length = 0
  const effect = definition()
  const heading = document.createElement('h2'); heading.textContent = effect.name; heading.title = effect.description; side.append(heading)
  // 参数按登记顺序摆放；同组的连续参数收进一个可折叠分组，没有分组的直接放在外面。
  let section: HTMLElement = side; let current: string | undefined
  for (const param of effect.params) {
    if (param.group !== current) {
      current = param.group
      if (current) {
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = current
        details.append(summary); side.append(details); section = details
      } else section = side
    }
    const row = document.createElement('div'); row.className = 'row'; row.title = param.description
    const label = document.createElement('label'); label.textContent = param.name; row.append(label)
    const value = document.createElement('span')
    let control: HTMLInputElement | HTMLSelectElement
    if (param.type === 'number') {
      control = Object.assign(document.createElement('input'), { type: 'range', min: String(param.min), max: String(param.max), step: String(param.step) })
      control.addEventListener('input', () => { params[param.key] = Number(control.value); value.textContent = control.value; void render() })
      refresh.push(() => { control.value = String(params[param.key]); value.textContent = String(params[param.key]) })
    } else if (param.type === 'enum') {
      control = document.createElement('select'); for (const option of param.options) control.add(new Option(option.label, option.value))
      control.addEventListener('change', () => { params[param.key] = control.value; refresh.forEach(update => update()); void render() })
      refresh.push(() => { control.value = String(params[param.key]) })
    } else if (param.type === 'boolean') {
      control = Object.assign(document.createElement('input'), { type: 'checkbox' })
      control.addEventListener('change', () => { params[param.key] = (control as HTMLInputElement).checked; void render() })
      refresh.push(() => { (control as HTMLInputElement).checked = params[param.key] === true })
    } else {
      control = Object.assign(document.createElement('input'), { type: 'color' })
      control.addEventListener('input', () => { params[param.key] = control.value; void render() })
      refresh.push(() => { control.value = String(params[param.key]) })
    }
    row.append(control, value); section.append(row)
    const shownWhen = param.visibleWhen
    if (shownWhen) refresh.push(() => { row.style.display = (shownWhen.in ?? [shownWhen.equals]).includes(params[shownWhen.param]) ? '' : 'none' })
  }
  const reset = Object.assign(document.createElement('button'), { textContent: '恢复默认' })
  reset.addEventListener('click', () => { resetParams(); void render() })
  side.append(document.createElement('br'), reset)
  resetParams()
}

// ---- 渲染
let frame = 0; let pending = false; let again = false; const timings: number[] = []
async function render(): Promise<void> {
  if (pending) { again = true; return }
  pending = true
  const mode = $<HTMLSelectElement>('mode').value
  const started = performance.now()
  if (mode !== 'original') {
    const instance = { id: effectSelect.value, params: { ...params } }
    await effects.render(instance as never, { texture: input as unknown as GpuTexture, width: W, height: H, format: 'rgba8unorm' }, output as unknown as GpuTexture, frame++)
    await device.queue.onSubmittedWorkDone()
  }
  const elapsed = performance.now() - started
  if (mode !== 'original') { timings.push(elapsed); if (timings.length > 30) timings.shift() }
  const sorted = [...timings].sort((a, b) => a - b)
  $('stats').textContent = sorted.length ? `1920×1080 每帧 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms（中位数，含提交等待）` : ''
  const split = mode === 'split' ? W / 2 : mode === 'original' ? W + 1 : -1
  device.queue.writeBuffer(uniforms, 0, new Float32Array([...backdropSrgb(), 1, split, 0, 0, 0]))
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }, { binding: 1, resource: input.createView() }, { binding: 2, resource: { buffer: uniforms } }] }))
  pass.draw(3); pass.end(); device.queue.submit([encoder.finish()])
  pending = false
  if (again) { again = false; void render() }
}

function animate(time: number): void {
  if ($<HTMLInputElement>('animate').checked) {
    params.radius = Math.round((0.5 - 0.5 * Math.cos(time / 1800)) * 1000) / 10
    refresh.forEach(update => update()); void render()
  }
  requestAnimationFrame(animate)
}

sampleSelect.addEventListener('change', () => { resetParams(); loadSample(); void render() })
effectSelect.addEventListener('change', () => { buildPanel(); void render() })
for (const id of ['backdrop', 'mode']) $(id).addEventListener('change', () => void render())
document.addEventListener('dragover', event => event.preventDefault())
document.addEventListener('drop', async event => {
  event.preventDefault()
  const file = event.dataTransfer?.files[0]; if (!file) return
  photo = await createImageBitmap(file); sampleSelect.value = 'photo'; sampleSelect.dispatchEvent(new Event('change'))
})

$('actual').addEventListener('change', event => { canvas.style.maxWidth = canvas.style.maxHeight = (event.target as HTMLInputElement).checked ? 'none' : ''; $('view').style.overflow = 'auto'; $('view').style.alignItems = $('view').style.justifyContent = (event.target as HTMLInputElement).checked ? 'flex-start' : '' })

/** 调试用：读回效果输出一行像素（预乘 sRGB 编码，0–255）。 */
Object.assign(window, {
  probe: async (y: number, x0: number, x1: number, step = 1): Promise<number[][]> => {
    const bytesPerRow = W * 4; const buffer = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: output, origin: [0, y] }, { buffer, bytesPerRow }, [W, 1]); device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ); const data = new Uint8Array(buffer.getMappedRange().slice(0)); buffer.destroy()
    const row: number[][] = []; for (let x = x0; x < x1; x += step) row.push([...data.slice(x * 4, x * 4 + 4)])
    return row
  },
  params, render,
})

buildPanel()
await document.fonts.ready
loadSample(); void render(); requestAnimationFrame(animate)
