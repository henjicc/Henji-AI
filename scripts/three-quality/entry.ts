/**
 * 三维画质基准的页面端：直接用宿主的统一三维渲染器（VideoEditThreeSpace）画一个固定的代表性场景，
 * 量实时各档与路径追踪各采样数的每帧耗时，并读回画面交给主进程存图。由 scripts/bench-three-quality.cjs 打包并启动。
 */
import type * as Three from 'three'
import { VideoEditThreeSpace, type ThreeSpaceEffects } from '@/features/videoEdit/engine/videoEditThreeSpace'
import { loadAuthorThreeLibrary, loadAuthorThreeModule } from '@/features/videoEdit/engine/videoEditAuthorThreeWebGpu'
import { createSpaceMaterial } from '@/features/videoEdit/engine/videoEditSpaceMaterials'
import { setVideoEditDenoiserWeights } from '@/features/videoEdit/engine/videoEditDenoiserWeights'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { SpatialFrame } from '@/core/videoEdit/spatialTypes'
import type { SpatialLight } from '@/core/videoEdit/spatialLights'

export interface BenchCase {
  name: string
  width: number
  height: number
  /** realtime：连续画 frames 帧量平均；trace：从头追踪到 samples 为止（denoise 为是时降噪）。 */
  mode: 'realtime' | 'trace'
  effects?: Partial<ThreeSpaceEffects>
  frames?: number
  samples?: number
  denoise?: boolean
  /** 存图（PNG，主进程写盘）。 */
  image?: boolean
  /** 去掉墙和地面：物体浮在透明处（三维组叠在视频上的常见情形）。 */
  empty?: boolean
}
export interface BenchResult { name: string; width: number; height: number; mode: string; ms: number[]; meanMs: number; p95Ms: number; png?: string; error?: string }

const BASE_EFFECTS: ThreeSpaceEffects = {
  display: 'realtime', motionBlur: false, depthOfField: false, focusDistance: 3.4, cocScale: 0, cocMax: 0, shutterScale: 1,
  bloom: 0, bloomThreshold: .75, bloomRadius: .45, ambientOcclusion: 0, reflections: 0, globalIllumination: 0, emission: false, exposure: 0, toneMapping: 'neutral',
  environment: 'studioNeutral', environmentIntensity: 1, environmentRotation: 0,
}

const LIGHTS: SpatialLight[] = [{ clipId: 'key', kind: 'spot', color: '#ffffff', intensity: 1.2, castShadow: true, softness: .6, angle: 55,
  position: [-1.6, 2.2, 2.2], direction: [.55, -.62, -.56], size: 1 }]

async function device(): Promise<GpuDevice> {
  const gpu = (navigator as unknown as { gpu: { requestAdapter(options: unknown): Promise<{ limits: Record<string, number>; features: Set<string>; requestDevice(descriptor: unknown): Promise<GpuDevice> } | null> } }).gpu
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('没有 GPU 适配器')
  // 与宿主合成设备同一组上限（见 ImageEditWebGpuDeviceManager）；可选特性按宿主合成器申请的那几样。
  const requiredLimits = Object.fromEntries(['maxTextureDimension2D', 'maxStorageBuffersInVertexStage', 'maxStorageTexturesInVertexStage', 'maxStorageBuffersInFragmentStage', 'maxStorageTexturesInFragmentStage', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupStorageSize']
    .filter(key => adapter.limits[key] > 0).map(key => [key, adapter.limits[key]]))
  const requiredFeatures = ['rg11b10ufloat-renderable'].filter(name => adapter.features.has(name))
  return adapter.requestDevice({ requiredLimits, requiredFeatures })
}

/** 代表性场景：白色墙角（承接色溢与遮蔽）、红色方块、蓝色圆柱、金属扭结、实心玻璃球与几颗磨砂小球。 */
function buildScene(library: typeof Three, tsl: unknown): Three.Group {
  const scene = new library.Scene()
  const matte = (color: number, roughness = .85) => createSpaceMaterial(library, tsl as never, 'matte', { color, roughness })
  const add = (geometry: Three.BufferGeometry, material: Three.Material, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): Three.Mesh => {
    const mesh = new library.Mesh(geometry, material)
    mesh.position.set(...position); mesh.rotation.set(...rotation)
    mesh.castShadow = mesh.receiveShadow = true
    scene.add(mesh)
    return mesh
  }
  add(new library.PlaneGeometry(10, 10), matte(0xdedad4), [0, -.5, 0], [-Math.PI / 2, 0, 0]).name = 'backdrop'
  add(new library.PlaneGeometry(10, 6), matte(0xd6d3cf), [0, 2.5, -1.3]).name = 'backdrop'
  add(new library.BoxGeometry(.62, .62, .62), matte(0xc23a2b, .7), [-.85, -.19, -.45], [0, .5, 0])
  add(new library.CylinderGeometry(.24, .24, .9, 64), matte(0x2c64c8, .6), [.95, -.05, -.65])
  add(new library.TorusKnotGeometry(.2, .07, 256, 32), createSpaceMaterial(library, tsl as never, 'metal', { color: '#d9b27c', roughness: .22 }), [0, -.02, -.05], [.3, .4, 0])
  add(new library.SphereGeometry(.2, 96, 64), createSpaceMaterial(library, tsl as never, 'glass', {}), [.42, -.3, .5])
  for (const [x, z, color] of [[-.35, .55, 0xf2efe8], [-.62, .3, 0x3f9a5c], [.15, .75, 0xe8b33a]] as const) add(new library.SphereGeometry(.1, 64, 32), matte(color, .5), [x, -.4, z])
  const root = new library.Group()
  root.matrixAutoUpdate = false
  root.add(scene)
  root.updateMatrixWorld(true)
  return root
}

function frameOf(library: typeof Three, width: number, height: number): SpatialFrame {
  const camera = new library.PerspectiveCamera(30, width / height, .05, 40)
  camera.coordinateSystem = library.WebGPUCoordinateSystem
  camera.position.set(.15, .55, 3.6)
  camera.lookAt(0, -.15, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return { sequenceTime: 0, output: { displayWidth: width, displayHeight: height },
    camera: { view: camera.matrixWorldInverse.toArray(), projectionWebGpu: camera.projectionMatrix.toArray(), up: [0, 1, 0], near: camera.near, far: camera.far,
      fovYRadians: camera.fov * Math.PI / 180, focusDistance: 3.6 } } as unknown as SpatialFrame
}

function halfToFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1, exponent = (value >> 10) & 0x1f, fraction = value & 0x3ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

async function readPng(gpu: GpuDevice, texture: GpuTexture, width: number, height: number): Promise<string> {
  const bytesPerRow = width * 8
  const buffer = (gpu as unknown as { createBuffer(d: unknown): { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; destroy(): void } }).createBuffer({ size: bytesPerRow * height, usage: 0x0001 | 0x0008 })
  const encoder = gpu.createCommandEncoder() as unknown as { copyTextureToBuffer(a: unknown, b: unknown, c: unknown): void; finish(): unknown }
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height })
  gpu.queue.submit([encoder.finish() as never])
  await buffer.mapAsync(1)
  const half = new Uint16Array(buffer.getMappedRange().slice(0))
  buffer.destroy()
  const pixels = new Uint8ClampedArray(width * height * 4)
  // 组画面是预乘、2.4 伽马编码的显示色：铺在黑底上即原样。
  for (let index = 0; index < width * height; index++) {
    for (let channel = 0; channel < 3; channel++) pixels[index * 4 + channel] = Math.round(Math.min(1, Math.max(0, halfToFloat(half[index * 4 + channel]))) * 255)
    pixels[index * 4 + 3] = 255
  }
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

export async function runBench(cases: BenchCase[], weightsUrl: string | undefined, report: (result: BenchResult) => void): Promise<void> {
  const gpu = await device()
  const library = await loadAuthorThreeLibrary() as unknown as typeof Three
  const tsl = await loadAuthorThreeModule('three/tsl')
  const space = await VideoEditThreeSpace.create(gpu, undefined)
  const root = buildScene(library, tsl)
  const targets = new Map<string, GpuTexture>()
  for (const item of cases) {
    try {
      const key = `${item.width}x${item.height}`
      let texture = targets.get(key)
      if (!texture) { texture = gpu.createTexture({ size: [item.width, item.height], format: 'rgba16float', usage: 0x01 | 0x02 | 0x04 | 0x10 }); targets.set(key, texture) }
      const effects = { ...BASE_EFFECTS, ...item.effects, display: item.mode === 'trace' ? 'render' : 'realtime' } as ThreeSpaceEffects
      const input = { frame: frameOf(library, item.width, item.height), cards: [], scenes: [{ clipId: 'scene', root, time: 0, opacity: 1 }], effects,
        target: { texture, width: item.width, height: item.height }, light: true, lights: LIGHTS, assertCurrent: () => undefined }
      root.traverse(object => { if (object.name === 'backdrop') object.visible = !item.empty })
      const ms: number[] = []
      if (item.mode === 'realtime') {
        for (let warm = 0; warm < 3; warm++) { await space.render(input); await gpu.queue.onSubmittedWorkDone() }
        for (let frame = 0; frame < (item.frames ?? 30); frame++) {
          const started = performance.now()
          await space.render(input)
          await gpu.queue.onSubmittedWorkDone()
          ms.push(performance.now() - started)
        }
      } else {
        setVideoEditDenoiserWeights(item.denoise && weightsUrl ? weightsUrl : '')
        const started = performance.now()
        // 同一个追踪器（加速结构、贴图图集、降噪网络已建好，与成片连续出帧一样），每次换一个画面身份：从头累积，
        // 测的是一帧成片的完整耗时（含降噪）。
        let refining = true
        const trace = { group: 'bench', key: `${item.name}:${Math.random()}`, samples: item.samples ?? 256 }
        while (refining) { refining = (await space.render({ ...input, trace })).refining; await gpu.queue.onSubmittedWorkDone() }
        ms.push(performance.now() - started)
      }
      const sorted = [...ms].sort((a, b) => a - b)
      report({ name: item.name, width: item.width, height: item.height, mode: item.mode, ms, meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
        p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], ...(item.image ? { png: await readPng(gpu, texture, item.width, item.height) } : {}) })
    } catch (error) {
      report({ name: item.name, width: item.width, height: item.height, mode: item.mode, ms: [], meanMs: NaN, p95Ms: NaN, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) })
    }
  }
  await space.dispose()
}
