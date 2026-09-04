import { effect, frame, sampler, target, type Effect, type Gpu, type Target } from 'vgpu'

const CLEAR = [0, 0, 0, 0] as const

const COPY_SHADER = `
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1);
}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f {
  return textureLoad(sourceTexture,vec2i(p.xy),0);
}`

const RESIDUAL_SHADER = `
struct Params { region: vec4f }
@group(0) @binding(0) var localFull: texture_2d<f32>;
@group(0) @binding(1) var globalLow: texture_2d<f32>;
@group(0) @binding(2) var localLow: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1);
}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f {
  let size=max(vec2f(textureDimensions(localFull)),vec2f(1));
  let uv=p.xy/size;
  let globalUv=params.region.xy+uv*params.region.zw;
  let high=textureLoad(localFull,vec2i(p.xy),0);
  let global=textureSampleLevel(globalLow,linearSampler,globalUv,0.0);
  let local=textureSampleLevel(localLow,linearSampler,uv,0.0);
  return high+global-local;
}`

const BEGIN_OVERLAP_SHADER = `
struct Params { core: vec4f, output: vec4f }
@group(0) @binding(0) var globalLow: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1);
}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f {
  let globalPixel=params.core.xy+p.xy;
  return textureSampleLevel(globalLow,linearSampler,globalPixel/params.output.xy,0.0);
}`

const ACCUMULATE_OVERLAP_SHADER = `
struct Params { core: vec4f, patchRender: vec4f, patchCore: vec4f, output: vec4f, grid: vec4f }
@group(0) @binding(0) var previous: texture_2d<f32>;
@group(0) @binding(1) var localFull: texture_2d<f32>;
@group(0) @binding(2) var localLow: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1);
}
fn axisWeight(coord:f32,start:f32,size:f32,outputSize:f32,gridSize:f32)->f32 {
  let center=start+size*0.5;
  if (coord<center) {
    if (start<=0.0) { return 1.0; }
    let leftCenter=start-gridSize*0.5;
    return clamp((coord-leftCenter)/(center-leftCenter),0.0,1.0);
  }
  if (start+size>=outputSize) { return 1.0; }
  let rightStart=start+size;
  let rightSize=min(gridSize,outputSize-rightStart);
  let rightCenter=rightStart+rightSize*0.5;
  return clamp((rightCenter-coord)/(rightCenter-center),0.0,1.0);
}
@fragment fn fs_main(@builtin(position) p:vec4f)->@location(0) vec4f {
  let globalPixel=params.core.xy+p.xy;
  let uv=(globalPixel-params.patchRender.xy)/params.patchRender.zw;
  let high=textureSampleLevel(localFull,linearSampler,uv,0.0);
  let local=textureSampleLevel(localLow,linearSampler,uv,0.0);
  let weight=axisWeight(globalPixel.x,params.patchCore.x,params.patchCore.z,
    params.output.x,params.grid.x)*axisWeight(globalPixel.y,params.patchCore.y,
    params.patchCore.w,params.output.y,params.grid.y);
  return textureLoad(previous,vec2i(p.xy),0)+(high-local)*weight;
}`

export interface ImageEditorGpuExportOverlapRectV3 {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** GPU 内合并全分辨率局部结果与有界全局低频残差；最终只回读一次。 */
export class ImageEditorGpuExportResidualV3 {
  private readonly copy: Effect
  private readonly residual: Effect
  private readonly beginOverlap: Effect
  private readonly accumulateOverlap: Effect
  private readonly linearSampler: ReturnType<typeof sampler>
  private output: Target
  private alternate: Target
  private copyCompiled = false
  private residualCompiled = false
  private beginOverlapCompiled = false
  private accumulateOverlapCompiled = false
  private disposed = false

  constructor(private readonly gpu: Gpu) {
    this.copy = effect(gpu, COPY_SHADER, { label: 'image-editor-export-copy' })
    this.residual = effect(gpu, RESIDUAL_SHADER, { label: 'image-editor-export-residual' })
    this.beginOverlap = effect(gpu, BEGIN_OVERLAP_SHADER, { label: 'image-editor-export-overlap-begin' })
    this.accumulateOverlap = effect(gpu, ACCUMULATE_OVERLAP_SHADER,
      { label: 'image-editor-export-overlap-accumulate' })
    this.linearSampler = sampler(gpu, { minFilter: 'linear', magFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    this.output = this.makeTarget([1, 1], 'image-editor-export-residual-output', 'rgba32float')
    this.alternate = this.makeTarget([1, 1], 'image-editor-export-residual-alternate', 'rgba32float')
  }

  async clone(source: Target, label: string): Promise<Target> {
    this.assertUsable()
    const output = this.makeTarget(source.size, label)
    this.copy.set({ sourceTexture: source })
    if (!this.copyCompiled) {
      await this.copy.compile(output)
      this.copyCompiled = true
    }
    await frame(this.gpu, (current) => current.pass({ target: output, clear: CLEAR }, this.copy)).done
    await this.gpu.settled()
    return output
  }

  async read(
    localFull: Target,
    globalLow: Target,
    localLow: Target,
    region: readonly [number, number, number, number],
  ): Promise<Float32Array> {
    this.assertUsable()
    if (this.output.size[0] !== localFull.size[0] || this.output.size[1] !== localFull.size[1]) {
      this.output.resize(localFull.size)
    }
    this.residual.set({ localFull, globalLow, localLow, linearSampler: this.linearSampler,
      params: { region: [...region] } })
    if (!this.residualCompiled) {
      await this.residual.compile(this.output)
      this.residualCompiled = true
    }
    await frame(this.gpu, (current) => current.pass({ target: this.output, clear: CLEAR }, this.residual)).done
    await this.gpu.settled()
    return await this.output.readFloats()
  }

  async beginOverlapAdd(
    globalLow: Target,
    core: ImageEditorGpuExportOverlapRectV3,
    outputSize: readonly [number, number],
  ): Promise<void> {
    this.assertUsable()
    this.resizeOverlapTargets(core.width, core.height)
    this.beginOverlap.set({ globalLow, linearSampler: this.linearSampler,
      params: { core: [core.x, core.y, core.width, core.height],
        output: [outputSize[0], outputSize[1], 0, 0] } })
    if (!this.beginOverlapCompiled) {
      await this.beginOverlap.compile(this.output)
      this.beginOverlapCompiled = true
    }
    await frame(this.gpu, (current) => current.pass(
      { target: this.output, clear: CLEAR }, this.beginOverlap,
    )).done
  }

  async accumulatePatch(
    localFull: Target,
    localLow: Target,
    core: ImageEditorGpuExportOverlapRectV3,
    patchRender: ImageEditorGpuExportOverlapRectV3,
    patchCore: ImageEditorGpuExportOverlapRectV3,
    outputSize: readonly [number, number],
    tileSize: readonly [number, number],
  ): Promise<void> {
    this.assertUsable()
    this.accumulateOverlap.set({ previous: this.output, localFull, localLow,
      linearSampler: this.linearSampler, params: {
        core: [core.x, core.y, core.width, core.height],
        patchRender: [patchRender.x, patchRender.y, patchRender.width, patchRender.height],
        patchCore: [patchCore.x, patchCore.y, patchCore.width, patchCore.height],
        output: [outputSize[0], outputSize[1], 0, 0],
        grid: [tileSize[0], tileSize[1], 0, 0],
      } })
    if (!this.accumulateOverlapCompiled) {
      await this.accumulateOverlap.compile(this.alternate)
      this.accumulateOverlapCompiled = true
    }
    await frame(this.gpu, (current) => current.pass(
      { target: this.alternate, clear: CLEAR }, this.accumulateOverlap,
    )).done
    const previous = this.output
    this.output = this.alternate
    this.alternate = previous
  }

  async readOverlapAdd(): Promise<Float32Array> {
    this.assertUsable()
    await this.gpu.settled()
    return await this.output.readFloats()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.output.color.destroy()
    this.alternate.color.destroy()
  }

  private makeTarget(
    size: readonly [number, number],
    label: string,
    format: 'rgba16float' | 'rgba32float' = 'rgba16float',
  ): Target {
    return target(this.gpu, { size, format, clearColor: CLEAR, label })
  }

  private resizeOverlapTargets(width: number, height: number): void {
    if (this.output.size[0] !== width || this.output.size[1] !== height) {
      this.output.resize([width, height])
      this.alternate.resize([width, height])
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GPU 导出残差合成器已销毁')
  }
}
