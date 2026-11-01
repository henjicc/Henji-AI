import { expect, it, vi } from 'vitest'
import * as Three from 'three'
import ts from 'typescript'
import { authorSpaceInfo, assertThreeMaterials, VideoEditAuthorThree } from './videoEditAuthorThree'
import * as bridgeModule from './videoEditAuthorThreeWebGpu'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { authorEffectMetadata } from './videoEditAuthorParameters'
import { authorThreeDiagnostics } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { CODE_AUTHOR_SPATIAL_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { fingerprintAuthorFrameKey } from './videoEditAuthorFingerprint'
import type { SpatialFrame } from '@/core/videoEdit/spatialTypes'
import { spatialIdentityMatrix, spatialProjection, spatialView } from '@/core/videoEdit/spatialMatrices'

it('受管相机复核作者改动，根变换仅应用一次，共享材质在最后一个实例释放', async () => {
  const library = Three as bridgeModule.AuthorThreeLibrary
  const loaded = vi.spyOn(bridgeModule, 'loadAuthorThreeLibrary').mockResolvedValue(library)
  const disposed = vi.fn(async () => {})
  const created = vi.spyOn(bridgeModule.VideoEditAuthorThreeWebGpu, 'create').mockResolvedValue({ library, backend: 'webgpu', dispose: disposed } as unknown as bridgeModule.VideoEditAuthorThreeWebGpu)
  const geometry = new Three.BoxGeometry(1, 1, 1), material = new Three.MeshBasicMaterial()
  const releaseGeometry = vi.spyOn(geometry, 'dispose'), releaseMaterial = vi.spyOn(material, 'dispose')
  let camera!: Three.PerspectiveCamera
  const factory = (host: import('./videoEditAuthorThree').AuthorThreeHost) => {
    camera = host.camera
    const scene = new Three.Scene(); scene.add(new Three.Mesh(geometry, material))
    return { scene, update() { host.camera.position.set(90, 90, 90); host.camera.projectionMatrix.identity() } }
  }
  const first = await VideoEditAuthorThree.create({} as GpuDevice, factory, 100, 100)
  const second = await VideoEditAuthorThree.create({} as GpuDevice, factory, 100, 100)
  const view = spatialView([0, 0, 2], [0, 0, 0]), projection = spatialProjection(1, 2, .01, 100, true)
  const root = new Three.Matrix4().makeTranslation(3, 0, 0).toArray() as unknown as import('@/core/videoEdit/spatialTypes').SpatialMat4
  const space: import('./videoEditAuthorThree').AuthorSpaceInfo = { camera: { ...view, position: [0, 0, 2], target: [0, 0, 0], up: [0, 1, 0], near: .01, far: 100,
    focalLengthMm: 80, sensorWidthMm: 36, focusDistance: 2, fStop: 4, defocus: 0, fovYRadians: .5, projectionWebGpu: projection,
    projectionWebGl: spatialProjection(1, 2, .01, 100, false), canonicalIdentity: false, resolvedAim: [0, 0, 0], resolvedFocus: [0, 0, 0], targetActive: true }, root,
    sequenceTime: 37, sampleTime: 37, sourceTime: 37, centerSourceTime: 37, project: point => point,
    output: { width: 100, height: 100, displayWidth: 100, displayHeight: 100 } }
  const info = { time: 37, frameDuration: 1 / 30, clip: { time: 37, duration: 60 }, space }
  try {
    expect(first.update({}, {}, info)).toEqual({ min: [2.5, -.5, -.5], max: [3.5, .5, .5] })
    second.update({}, {}, info)
    expect(camera.position.toArray()).toEqual([0, 0, 2])
    expect(camera.projectionMatrix.elements).toEqual(projection)
    await first.dispose(); expect(releaseGeometry).not.toHaveBeenCalled(); expect(releaseMaterial).not.toHaveBeenCalled()
    await second.dispose(); expect(releaseGeometry).toHaveBeenCalledOnce(); expect(releaseMaterial).toHaveBeenCalledOnce()
    expect(disposed).toHaveBeenCalledTimes(2)
  } finally { await first.dispose(); await second.dispose(); loaded.mockRestore(); created.mockRestore() }
})

it('空间声明隔离旧作者，常量 frameKey 仍受空间源时刻与相机约束', async () => {
  const view = spatialView([0, 0, 2], [0, 0, 0])
  const frame: SpatialFrame = { sequenceFrame: 30, sequenceTime: 1, output: { width: 100, height: 100, displayWidth: 100, displayHeight: 100 },
    cards: [], flatIdentity: false, facts: [], camera: { ...view, position: [0, 0, 2], target: [0, 0, 0], focalLengthMm: 80, sensorWidthMm: 36,
      focusDistance: 2, fStop: 4, defocus: 0, near: .01, far: 100, fovYRadians: .5, projectionWebGpu: spatialProjection(1, 2, .01, 100, true),
      projectionWebGl: spatialProjection(1, 2, .01, 100, false), canonicalIdentity: false, resolvedAim: [0, 0, 0], resolvedFocus: [0, 0, 0], targetActive: true } }
  const space = await authorSpaceInfo(frame, 'scene', 37, 37)
  expect(space.root).toEqual(spatialIdentityMatrix())
  expect(space.project([0, 0, 0]).slice(0, 2)).toEqual([.5, .5])
  expect(Reflect.set(space.camera.position, '0', 20)).toBe(false)
  const effect = { name: '空间', space: true, frameKey: () => 'constant', draw() {} }
  expect(() => authorEffectMetadata(effect, 7)).toThrow('空间作者')
  expect(authorEffectMetadata(effect, CODE_AUTHOR_SPATIAL_MIN_API_VERSION)).toMatchObject({ space: true })
  expect(authorEffectMetadata({ name: '平面', draw() {} }, CODE_AUTHOR_SPATIAL_MIN_API_VERSION)).not.toHaveProperty('space')
  const info = { time: 37, frameDuration: 1 / 30, clip: { time: 1, duration: 60 }, space }
  const fingerprint = (active: boolean, current = space) => fingerprintAuthorFrameKey({ ...effect, space: active }, { width: 100, height: 100 }, {}, { ...info, space: current }, {}, 'code', {}, undefined, true, {}, CODE_AUTHOR_SPATIAL_MIN_API_VERSION)
  const shifted = await authorSpaceInfo({ ...frame, sequenceTime: 2 }, 'scene', 12, 37)
  expect(fingerprint(true).digest).not.toBe(fingerprint(true, shifted).digest)
  expect(fingerprint(false)).toEqual(fingerprint(false, shifted))
})

it('静态导入别名与动态 JS 材质都明确拒绝 GLSL，既有 createWebGL 保持可用', () => {
  const text = "import { ShaderMaterial as Material } from 'three'; export default {name:'测试',createThree(){return {scene:new Scene(),update(){new Material()}}}}"
  expect(authorThreeDiagnostics(ts, { 'main.ts': text }, 'main.ts')).toMatchObject([{ code: 95002, span: { file: 'main.ts', startLine: 1 } }])
  expect(authorThreeDiagnostics(ts, { 'main.ts': text.replace('createThree', 'createWebGL') }, 'main.ts')).toEqual([])
  const scene = new Three.Scene(), geometry = new Three.BoxGeometry(), standard = new Three.MeshBasicMaterial(), shader = new Three.ShaderMaterial()
  const mesh = new Three.Mesh<Three.BoxGeometry, Three.Material>(geometry, standard)
  scene.add(mesh)
  expect(() => assertThreeMaterials(scene)).not.toThrow()
  mesh.material = shader
  expect(() => assertThreeMaterials(scene)).toThrow('GLSL')
  geometry.dispose(); standard.dispose(); shader.dispose()
})
