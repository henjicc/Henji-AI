// ticket 35 第 4 段可行性：WebGPU 路径追踪（three-gpu-pathtracer）在本机的收敛速度与画面。只用于验证。
import * as THREE from 'three/webgpu'
import { WebGPUPathTracer, PhysicalCamera } from 'three-gpu-pathtracer/webgpu'
import { cubeTexture, uv, vec3, cos, sin, float } from 'three/tsl'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

interface Config { width: number; height: number; samples: number[]; external: boolean; frameBudget?: number }
const canvas = document.getElementById('c') as HTMLCanvasElement

function cardCanvas(label: string, hue: number): OffscreenCanvas {
  const c = new OffscreenCanvas(1280, 720), g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, c.width, c.height)
  grad.addColorStop(0, `hsl(${hue},60%,35%)`); grad.addColorStop(1, `hsl(${hue + 40},60%,12%)`)
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#f4f4f4'; g.font = '700 150px sans-serif'; g.fillText(label, 90, 420)
  return c
}

/** 模拟渲染器里的卡片：画面只在 GPU 上（ExternalTexture 包着合成器的 GPUTexture）。 */
function gpuCardTexture(renderer: THREE.WebGPURenderer, source: OffscreenCanvas): THREE.Texture {
  const device = (renderer.backend as unknown as { device: GPUDevice }).device
  const texture = device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
  device.queue.copyExternalImageToTexture({ source }, { texture }, [source.width, source.height])
  const external = new THREE.ExternalTexture(texture)
  ;(external as unknown as { image: { width: number; height: number } }).image = { width: source.width, height: source.height }
  external.colorSpace = THREE.SRGBColorSpace
  return external
}

/** 追踪器的环境光要 CPU 上有数据的等距柱状图（按亮度做重要性采样）：GPU 上展开立方体贴图再读回。 */
async function equirectFromCube(renderer: THREE.WebGPURenderer, cube: THREE.CubeTexture): Promise<THREE.DataTexture> {
  const width = 512, height = 256
  const target = new THREE.RenderTarget(width, height, { type: THREE.FloatType })
  const material = new THREE.MeshBasicNodeMaterial()
  const phi = uv().x.sub(.5).mul(Math.PI * 2), theta = uv().y.sub(.5).mul(Math.PI)
  material.colorNode = cubeTexture(cube, vec3(cos(theta).mul(cos(phi)), sin(theta), cos(theta).mul(sin(phi))))
  const quad = new THREE.QuadMesh(material)
  renderer.setRenderTarget(target); quad.render(renderer); renderer.setRenderTarget(null)
  const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Float32Array
  target.dispose(); material.dispose()
  // 半精度：全精度浮点贴图在 WebGPU 里不能过滤采样，追踪器的着色器要用采样器读它。
  const half = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i])
  const texture = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  // DataTexture 默认最近邻过滤，three 会当作不可过滤、不声明采样器，追踪器的着色器就编译不过。
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  void float
  return texture
}

async function run(config: Config) {
  canvas.width = config.width; canvas.height = config.height
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false })
  await renderer.init()
  renderer.setPixelRatio(1); renderer.setSize(config.width, config.height, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  // 路径追踪要能逐像素采样的环境图：把房间环境渲进立方体贴图，由追踪器转成等距柱状图。
  const cubeTarget = new THREE.CubeRenderTarget(256, { type: THREE.HalfFloatType })
  new THREE.CubeCamera(0.1, 100, cubeTarget).update(renderer, new RoomEnvironment())
  scene.environment = await equirectFromCube(renderer, cubeTarget.texture)
  scene.background = new THREE.Color(0x05070a)
  scene.environmentIntensity = 0.25
  const camera = new PhysicalCamera(32, config.width / config.height, 0.1, 100)
  camera.position.set(0, 2.2, 9); camera.lookAt(0, 0.8, 0)
  camera.fStop = 2.2; camera.focusDistance = 9; camera.apertureBlades = 6

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, roughness: 0.15, metalness: 0.6 }))
  floor.rotation.x = -Math.PI / 2; scene.add(floor)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.9 }))
  back.position.set(0, 6, -6); scene.add(back)
  const materials = [
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transmission: 1, thickness: 1, ior: 1.5 }),
    new THREE.MeshPhysicalMaterial({ color: 0xd4a14a, roughness: 0.25, metalness: 1 }),
    new THREE.MeshPhysicalMaterial({ color: 0xb8202a, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }),
  ]
  materials.forEach((material, i) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 96, 48), material); s.position.set(-2.4 + i * 2.4, 0.7, 1.2); scene.add(s) })
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.17, 256, 32), new THREE.MeshPhysicalMaterial({ color: 0x5fd0ff, roughness: 0.1, metalness: 0.1, iridescence: 1 }))
  knot.position.set(3.4, 1.1, -1); scene.add(knot)
  // 视频卡片：自发光贴图（画面），不受灯光影响，同时照亮周围。
  const cards = [cardCanvas('痕迹 AI', 210), cardCanvas('路径追踪', 20)]
  cards.forEach((source, i) => {
    const map = config.external ? gpuCardTexture(renderer, source) : Object.assign(new THREE.CanvasTexture(source), { colorSpace: THREE.SRGBColorSpace })
    const card = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1, roughness: 1 }))
    card.position.set(-2 + i * 4, 2.6, -2.5 + i * 0.6); card.rotation.y = i ? -0.35 : 0.35; scene.add(card)
  })
  const area = new THREE.RectAreaLight(0xffe7c4, 12, 3, 3); area.position.set(-3, 6, 4); area.lookAt(0, 0, 0); scene.add(area)
  const spot = new THREE.SpotLight(0x6ab8ff, 80, 20, 0.5, 0.4); spot.position.set(4, 6, 3); spot.target.position.set(1, 0, 0); scene.add(spot, spot.target)

  const tracer = new WebGPUPathTracer(renderer)
  tracer.renderDelay = 0; tracer.fadeDuration = 0; tracer.minSamples = 0; tracer.dynamicLowRes = false
  if (config.frameBudget) tracer.frameBudget = config.frameBudget
  const setupStart = performance.now()
  tracer.setScene(scene, camera)
  const setupMs = performance.now() - setupStart
  const device = (renderer.backend as unknown as { device: GPUDevice }).device
  const shots: Record<string, string> = {}
  const marks: Array<{ samples: number; ms: number }> = []
  const start = performance.now()
  let calls = 0
  const trace: Array<{ calls: number; ms: number; min: number; avg: number }> = []
  for (const target of config.samples) {
    for (;;) {
      for (let i = 0; i < 4; i++) { tracer.renderSample(); calls++ }
      await device.queue.onSubmittedWorkDone()
      const counts = await tracer.getSampleCountsAsync()
      trace.push({ calls, ms: performance.now() - start, min: counts.min, avg: counts.avg })
      if (counts.min >= target || performance.now() - start > 90000) break
    }
    marks.push({ samples: target, ms: performance.now() - start })
    shots[target] = canvas.toDataURL('image/png')
    if (performance.now() - start > 90000) break
  }
  renderer.dispose()
  return { setupMs, marks, calls, shots, trace: trace.filter((_, i) => i % 8 === 0 || i === trace.length - 1) }
}
;(window as unknown as { runPathTrace: typeof run }).runPathTrace = run
