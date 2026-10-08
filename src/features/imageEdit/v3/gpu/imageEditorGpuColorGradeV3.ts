import { draw, effect, target, type Draw, type Effect, type Gpu, type Target, type Texture } from 'vgpu'
import { adjustmentPassesWgsl } from '@/core/imaging/effects/wgsl/adjustmentPasses'
import { planColorGrade, isNeutralAdjustmentPlan, type AdjustmentTexture } from '@/core/imaging/adjustments/plan'
import { imageColorGradeRuntimeParams } from '@/core/imaging/adjustments/schema'
import { linearWorkingSpaceMatrixV3 } from '@/core/imageEdit/v3/execution/tileColor'
import { assertImageColorGradeLutDomain } from '@/core/imageEdit/v3/effects/colorGrade'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditorGpuGraphAdjustmentV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { loadImageColorLutV3 } from '../execution/imageColorLutV3'
import boundaryShader from './shaders/imageEditorGpuColorGradeBoundaryV3.wgsl?raw'
import mixShader from './shaders/imageEditorGpuEffectMixV3.wgsl?raw'

type Buffer = ReturnType<Gpu['gpu']['createBuffer']>
const CLEAR = [0, 0, 0, 0] as const
// Workspace transfer boundary extends signed SDR values; adjustment formulas remain shared.
const shader = adjustmentPassesWgsl({ extendedRange: true, globalCoordinates: true })

/** A retained adjustment renderer: no source readback, pipeline recompilation or image upload on drag. */
export class ImageEditorGpuColorGradeV3 {
  private readonly scratch: Target[] = []
  private readonly draws = new Map<string, Draw>()
  private readonly compiled = new Set<Draw | Effect>()
  private readonly lookups = new Map<string, Texture>()
  private readonly buffers: Buffer[] = []
  private readonly toEncoded: Draw
  private readonly toLinear: Draw
  private readonly mix: Effect
  private readonly fallbackLut: Texture
  private readonly sampler: ReturnType<Gpu['gpu']['createSampler']>
  private passes: Array<{ draw: Draw | Effect; target: Target }> = []

  constructor(private readonly gpu: Gpu, private readonly onCompiled: () => void) {
    this.toEncoded = draw(gpu, { shader: boundaryShader, vertices: 3 })
    this.toLinear = draw(gpu, { shader: boundaryShader, vertices: 3 })
    this.mix = effect(gpu, mixShader)
    this.fallbackLut = gpu.device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba32float', usage: ['texture_binding'] })
    this.sampler = gpu.gpu.createSampler({ minFilter: 'linear', magFilter: 'linear' })
  }
  private surface(index: number, size: readonly [number, number]): Target {
    const result = this.scratch[index] ??= target(this.gpu, { size, format: 'rgba16float', clearColor: CLEAR })
    if (result.size[0] !== size[0] || result.size[1] !== size[1]) result.resize(size)
    return result
  }
  private uniform(index: number, data: Float32Array): Buffer {
    const buffer = this.buffers[index] ??= this.gpu.gpu.createBuffer({ size: data.byteLength, usage: 0x08 | 0x40 })
    this.gpu.gpu.queue.writeBuffer(buffer, 0, data)
    return buffer
  }
  private boundary(drawable: Draw, input: Target, output: Target, color: ImageEditColorModeV3, decode: boolean, index: number): void {
    const matrix = linearWorkingSpaceMatrixV3(decode ? 'srgb' : color.workingSpace, decode ? color.workingSpace : 'srgb')
    const data = new Float32Array([...matrix.slice(0, 3), 0, ...matrix.slice(3, 6), 0, ...matrix.slice(6, 9), 0, decode ? 1 : 0, 0, 0, 0])
    drawable.group(0, this.gpu.gpu.createBindGroup({ layout: drawable.layout(0), entries: [{ binding: 0, resource: input.color.view }, { binding: 1, resource: { buffer: this.uniform(index, data) } }] }))
    this.passes.push({ draw: drawable, target: output })
  }
  async prepare(adjustment: ImageEditorGpuGraphAdjustmentV3, input: Target, output: Target, mask: Target | null, color: ImageEditColorModeV3, view: { origin: readonly [number, number]; size: readonly [number, number]; basisX: readonly [number, number]; basisY: readonly [number, number] }): Promise<void> {
    const { opacity: _opacity, blendMode: _blend, transform: _transform, referenceWidth: _width, referenceHeight: _height, ...value } = adjustment.parameters
    const params = imageColorGradeRuntimeParams(value)
    assertImageColorGradeLutDomain(color, params)
    const plan = planColorGrade(params, input.size[0], input.size[1], view.size)
    this.passes = []
    const neutral = isNeutralAdjustmentPlan(plan)
    let linear = input
    if (!neutral) {
    const encoded = this.surface(0, input.size)
    this.boundary(this.toEncoded, input, encoded, color, false, 0)
    const processed = this.surface(1, input.size)
    const surfaces = plan.scratch.map((size, i) => this.surface(i + 3, [size.width, size.height]))
    const texture = (ref: AdjustmentTexture): Texture => ref === 'input' ? encoded.color : ref === 'output' ? processed.color : surfaces[ref].color
    for (let i = 0; i < plan.passes.length; i++) {
      const pass = plan.passes[i]
      if (pass.entry === 'color_grade_vignette') { pass.uniforms.set(view.origin, 10); pass.uniforms.set(view.basisX, 12); pass.uniforms.set(view.basisY, 14) }
      const key = `${i}:${pass.entry}`
      const drawable = this.draws.get(key) ?? draw(this.gpu, { shader, entry: { vertex: 'vs', fragment: pass.entry }, vertices: 3 })
      this.draws.set(key, drawable)
      let lookup: Texture | undefined
      const settings: Record<string, unknown> = { colorLut: this.fallbackLut, source: texture(pass.source), s: this.sampler, u: pass.uniforms, original: texture(pass.original ?? 'input'), gradeMask: texture(pass.mask ?? 'input') }
      if (pass.lookup) {
        const lookupKey = pass.lookup.kind === 'curve' ? `curve:${Array.from(pass.lookup.data).join(',')}` : pass.lookup.ref
        lookup = this.lookups.get(lookupKey)
        if (pass.lookup.kind === 'curve') {
          if (!lookup) {
            const rgba = new Float32Array(pass.lookup.data.length * 4)
            pass.lookup.data.forEach((x, j) => rgba.set([x, x, x, 1], j * 4))
            lookup = this.gpu.device.createTexture({ size: [pass.lookup.data.length, 1], format: 'rgba32float', usage: ['copy_dst', 'texture_binding'] })
            this.gpu.gpu.queue.writeTexture({ texture: lookup.gpu }, rgba, { bytesPerRow: pass.lookup.data.length * 16 }, { width: pass.lookup.data.length, height: 1 })
          }
          settings.original = lookup
        } else {
          const cube = await loadImageColorLutV3(pass.lookup.ref)
          if (!lookup) {
            const size = cube.kind === '3d' ? [cube.size, cube.size, cube.size] as const : [Math.min(1024, cube.size), Math.ceil(cube.size / 1024)] as const
            lookup = this.gpu.device.createTexture({ size, dimension: cube.kind === '3d' ? '3d' : '2d', format: 'rgba32float', usage: ['copy_dst', 'texture_binding'] })
            const data = new Float32Array(size[0] * size[1] * (size[2] ?? 1) * 4); data.set(cube.data)
            this.gpu.gpu.queue.writeTexture({ texture: lookup.gpu }, data, { bytesPerRow: size[0] * 16, rowsPerImage: size[1] }, { width: size[0], height: size[1], depthOrArrayLayers: size[2] ?? 1 })
          }
          pass.uniforms[5] = cube.kind === '1d' ? 1 : 0; pass.uniforms[6] = cube.size
          pass.uniforms.set(cube.domainMin, 8); pass.uniforms.set(cube.domainMax.map((x, j) => x - cube.domainMin[j]), 12)
          settings[cube.kind === '3d' ? 'colorLut' : 'original'] = lookup
        }
        this.lookups.set(lookupKey, lookup)
      }
      // set() owns per-draw uniforms; each plan position has its own draw, including repeated entries.
      settings.u = { size: Array.from(pass.uniforms.slice(0, 4)), a: Array.from(pass.uniforms.slice(4, 8)), b: Array.from(pass.uniforms.slice(8, 12)), c: Array.from(pass.uniforms.slice(12, 16)) }
      drawable.set(settings)
      this.passes.push({ draw: drawable, target: pass.target === 'output' ? processed : surfaces[pass.target as number] })
    }
    linear = this.surface(2, input.size)
    this.boundary(this.toLinear, processed, linear, color, true, 1)
    }
    for (const surface of this.scratch.splice(neutral ? 0 : plan.scratch.length + 3)) surface.color.destroy()
    this.mix.set({ originalTexture: input.color, processedTexture: linear.color, maskTexture: mask?.color ?? input.color,
      params: { options: [adjustment.opacity, blendIndex(adjustment.blendMode), 0, 0], maskOptions: [adjustment.mask ? 1 : 0, adjustment.mask?.defaultValue ?? 1, adjustment.mask?.inverted ? 1 : 0, 0] } })
    this.passes.push({ draw: this.mix, target: output })
    for (const pass of this.passes) if (!this.compiled.has(pass.draw)) { await pass.draw.compile(pass.target); this.compiled.add(pass.draw); this.onCompiled() }
    const active = new Set(plan.passes.flatMap(pass => !pass.lookup ? [] : [pass.lookup.kind === 'curve' ? `curve:${Array.from(pass.lookup.data).join(',')}` : pass.lookup.ref]))
    for (const [key, resource] of this.lookups) if (!active.has(key)) { resource.destroy(); this.lookups.delete(key) }
  }
  encode(frame: ReturnType<typeof import('vgpu').frame>): void { for (const pass of this.passes) frame.pass(pass.target, pass.draw) }
  dispose(): void { this.fallbackLut.destroy(); this.scratch.forEach(value => value.color.destroy()); this.buffers.forEach(value => value.destroy()); this.lookups.forEach(value => value.destroy()); this.lookups.clear(); this.draws.clear() }
}
function blendIndex(mode: string): number { return mode === 'multiply' ? 1 : mode === 'screen' ? 2 : mode === 'overlay' ? 3 : mode === 'soft-light' ? 4 : 0 }
