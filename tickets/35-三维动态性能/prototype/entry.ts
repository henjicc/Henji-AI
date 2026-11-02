// ticket 35 原型：统一 three 场景 + TSL 后处理的实时渲染器，测 1080p / 4K 帧时间。只用于验证可行性。
import * as THREE from 'three/webgpu'
import { pass, mrt, output, normalView, packNormalToRGB, unpackRGBToNormal, convertToTexture, sample, velocity, metalness, roughness, vec2, vec3, vec4, float, uniform, instanceIndex, hash, sin, cos, uv } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

interface Config { width: number; height: number; frames: number; warmup: number; ssr: boolean; ao: boolean; dof: boolean; motionBlur: boolean; bloom: boolean; traa: boolean; shadows: boolean; particles: number; dynamicCards: boolean; pipelineDepth: number; shot?: number[] }

const canvas = document.getElementById('c') as HTMLCanvasElement
let renderer: THREE.WebGPURenderer | undefined

function paintStatic(c: OffscreenCanvas, hue: number, label: string): void {
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, c.width, c.height)
  grad.addColorStop(0, `hsl(${hue},55%,28%)`); grad.addColorStop(1, `hsl(${hue + 40},60%,12%)`)
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = 'rgba(255,255,255,0.08)'
  for (let i = 0; i < 40; i++) g.fillRect((i * 97) % c.width, (i * 53) % c.height, 60, 4)
  g.fillStyle = '#f2f2f2'; g.font = `700 ${c.height / 6}px sans-serif`; g.fillText(label, c.width * 0.08, c.height * 0.55)
}
function paintDynamic(c: OffscreenCanvas, kind: number, t: number): void {
  const g = c.getContext('2d')!
  g.fillStyle = '#101418'; g.fillRect(0, 0, c.width, c.height)
  if (kind === 0) { // 视频式：逐帧变化的整幅画面
    for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) { g.fillStyle = `hsl(${(x * 18 + y * 9 + t * 120) % 360},60%,${30 + 20 * Math.sin(t * 3 + x + y)}%)`; g.fillRect(x * c.width / 20, y * c.height / 12, c.width / 20 + 1, c.height / 12 + 1) }
  } else if (kind === 1) { // 跳动的数字
    g.fillStyle = '#f2f2f2'; g.font = `700 ${c.height / 3}px sans-serif`; g.fillText(String(Math.floor(t * 1234) % 100000).padStart(5, '0'), c.width * 0.06, c.height * 0.62)
  } else { // 数据图表
    g.strokeStyle = '#6ad1ff'; g.lineWidth = 6; g.beginPath()
    for (let i = 0; i <= 60; i++) { const x = i / 60 * c.width, y = c.height * (0.5 + 0.35 * Math.sin(i * 0.35 + t * 2) * Math.cos(i * 0.11 - t)); if (i) g.lineTo(x, y); else g.moveTo(x, y) }
    g.stroke()
    for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(255,180,90,0.85)'; const h = c.height * (0.15 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.3 + i))); g.fillRect(i * c.width / 12 + 8, c.height - h, c.width / 12 - 16, h) }
  }
}

async function build(config: Config) {
  canvas.width = config.width; canvas.height = config.height
  renderer = new THREE.WebGPURenderer({ canvas, antialias: false, trackTimestamp: true })
  await renderer.init()
  renderer.setPixelRatio(1); renderer.setSize(config.width, config.height, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = config.shadows
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07090c)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.35
  const camera = new THREE.PerspectiveCamera(32, config.width / config.height, 0.1, 100)

  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 7, 5); sun.castShadow = config.shadows
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 })
  scene.add(sun)
  const p1 = new THREE.PointLight(0x4fa8ff, 30, 12); const p2 = new THREE.PointLight(0xff7a3d, 30, 12); scene.add(p1, p2)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardNodeMaterial({ color: 0x1a1d22, roughness: 0.18, metalness: 0.7 }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.2; floor.receiveShadow = true; scene.add(floor)

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.55, 64, 32), new THREE.MeshStandardNodeMaterial({ color: 0xd8d8d8, roughness: 0.08, metalness: 1 }))
  sphere.position.set(-1.8, -0.6, 0.4); sphere.castShadow = true
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.4, 0.13, 220, 32), new THREE.MeshStandardNodeMaterial({ color: 0xffb35a, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color(0x331100) }))
  knot.position.set(1.9, -0.4, 0.2); knot.castShadow = true
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardNodeMaterial({ color: 0x9fd7ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45 }))
  glass.position.set(0.2, -0.8, 1.2); glass.castShadow = true
  scene.add(sphere, knot, glass)

  const cards: Array<{ canvas: OffscreenCanvas; texture: THREE.CanvasTexture; dynamic: number }> = []
  const layout = [[-2.6, 1.0, -2.5, 25], [-0.9, 1.2, -3.2, 10], [0.9, 1.2, -3.2, -10], [2.6, 1.0, -2.5, -25], [-1.7, -0.1, -1.0, 15], [0, 0.2, -1.6, 0], [1.7, -0.1, -1.0, -15], [0, 1.9, -4.5, 0]]
  layout.forEach(([x, y, z, ry], i) => {
    const dynamic = config.dynamicCards && i >= 4 ? (i - 4) % 3 : -1
    const c = new OffscreenCanvas(1280, 720)
    if (dynamic < 0) paintStatic(c, i * 50, `卡片 ${i + 1}`)
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicNodeMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }))
    mesh.position.set(x, y, z); mesh.rotation.y = ry * Math.PI / 180; mesh.castShadow = true
    scene.add(mesh); cards.push({ canvas: c, texture, dynamic })
  })

  const tUniform = uniform(0)
  if (config.particles > 0) {
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const seed = float(instanceIndex)
    const r = hash(seed).mul(4).add(1), a = hash(seed.add(1)).mul(6.283).add(tUniform.mul(hash(seed.add(2)).mul(0.6).add(0.1))), h = hash(seed.add(3)).mul(3).sub(1)
    material.positionNode = vec3(cos(a).mul(r), h.add(sin(tUniform.add(seed)).mul(0.15)), sin(a).mul(r).sub(1.5))
    material.scaleNode = hash(seed.add(4)).mul(0.012).add(0.004)
    const d = uv().sub(0.5).length()
    material.colorNode = vec4(vec3(1.0, 0.75, 0.4).mul(float(1).sub(d.mul(2)).max(0).pow(2).mul(1.5)), float(1))
    const sprites = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material) as THREE.Mesh & { count: number }
    sprites.count = config.particles
    sprites.frustumCulled = false
    scene.add(sprites)
  }

  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), metalrough: vec2(metalness, roughness), velocity }))
  const color = scenePass.getTextureNode('output')
  const depth = scenePass.getTextureNode('depth')
  const normalTexture = scenePass.getTextureNode('normal')
  const normal = sample((coord) => unpackRGBToNormal(normalTexture.sample(coord)))
  const metalrough = scenePass.getTextureNode('metalrough')
  const vel = scenePass.getTextureNode('velocity')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let beauty: any = color
  if (config.ao) { const aoPass = ao(depth, normal, camera); aoPass.resolutionScale = 0.5; beauty = vec4(beauty.rgb.mul(aoPass.getTextureNode().r), beauty.a) }
  if (config.ssr) { const s = ssr(color, depth, normal, { metalnessNode: metalrough.r, roughnessNode: metalrough.g, camera }); (s as unknown as { resolutionScale: number }).resolutionScale = 0.5; beauty = vec4(beauty.rgb.add(s.rgb.mul(s.a)), beauty.a) }
  if (config.bloom) beauty = beauty.add(bloom(beauty, 0.35, 0.3, 0.9))
  const focus = uniform(4)
  if (config.dof) beauty = dof(beauty, scenePass.getViewZNode(), focus, 2.5, 1.2)
  // 速度是标准化设备坐标的帧间位移（跨度 2、y 向上）；换到画面坐标乘 0.5 并翻转 y，再按 180° 快门取一半。
  if (config.motionBlur) beauty = motionBlur(convertToTexture(beauty), vel.xy.mul(vec2(0.25, -0.25)))
  if (config.traa) beauty = traa(beauty, depth, vel, camera)
  const pipeline = new THREE.RenderPipeline(renderer)
  pipeline.outputNode = beauty

  const update = (t: number): void => {
    tUniform.value = t
    const orbit = 0.35 * Math.sin(t * 0.5), dist = 8 - 2.5 * (0.5 - 0.5 * Math.cos(t * 0.6))
    camera.position.set(Math.sin(orbit) * dist, 0.6 + 0.3 * Math.sin(t * 0.4), Math.cos(orbit) * dist)
    camera.lookAt(0, 0.2, -1.5)
    focus.value = 4 + 3 * (0.5 - 0.5 * Math.cos(t * 0.8))
    p1.position.set(Math.sin(t) * 3, 0.5, Math.cos(t) * 2); p2.position.set(-Math.sin(t * 0.7) * 3, 0.8, -Math.cos(t * 0.7) * 2)
    sphere.position.y = -0.6 + 0.2 * Math.sin(t * 1.7); knot.rotation.set(t * 0.8, t * 1.1, 0); glass.rotation.y = t * 0.5
    for (const card of cards) if (card.dynamic >= 0) { paintDynamic(card.canvas, card.dynamic, t); card.texture.needsUpdate = true }
  }
  return { pipeline, update }
}

;(window as unknown as { runPrototype: (config: Config) => Promise<unknown> }).runPrototype = async (config: Config) => {
  const { pipeline, update } = await build(config)
  const device = (renderer!.backend as unknown as { device: GPUDevice }).device
  const fps = 60
  const frameTimes: number[] = [], cpuTimes: number[] = [], gpuTimes: number[] = []
  const shots: Record<number, string> = {}
  const total = config.warmup + config.frames
  for (let i = 0; i < total; i++) {
    const start = performance.now()
    update(i / fps)
    pipeline.render()
    const submitted = performance.now()
    await device.queue.onSubmittedWorkDone()
    const done = performance.now()
    const gpu = (await renderer!.resolveTimestampsAsync('render')) ?? 0
    const compute = (await renderer!.resolveTimestampsAsync('compute')) ?? 0
    if (i >= config.warmup) { frameTimes.push(done - start); cpuTimes.push(submitted - start); gpuTimes.push(gpu + compute) }
    if (config.shot?.includes(i)) shots[i] = canvas.toDataURL('image/png')
  }
  const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]
  const result = { frameP50: q(frameTimes, 0.5), frameP95: q(frameTimes, 0.95), frameMax: Math.max(...frameTimes), over16: frameTimes.filter(v => v > 1000 / 60).length / frameTimes.length, cpuP50: q(cpuTimes, 0.5), cpuP95: q(cpuTimes, 0.95), gpuP50: q(gpuTimes, 0.5), gpuP95: q(gpuTimes, 0.95), shots }
  pipeline.dispose(); renderer!.dispose(); renderer = undefined
  return result
}
