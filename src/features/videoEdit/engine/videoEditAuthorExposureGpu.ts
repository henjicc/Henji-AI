import type { GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

/**
 * 按速度图收集的运动模糊（McGuire 2012、Jimenez 2014 的思路）：只画一次颜色和一次速度，耗时与走多快无关，也不会有分帧重影。
 * 快门在当前帧结束，拖影只留在运动方向的身后。分块记下附近最快的速度，每个像素沿速度方向往前取一串样本；
 * 这个样本刚才从这里经过才算数，每个样本的能量摊在它走过的整条路径上，所以亮度守恒，静止的像素原样不变。作者图层底色透明，这里按预乘颜色收集，不用猜背景。
 */

const quad = `@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1)); return vec4f(p[i],0,1); }`
const decode = `
fn velocityAt(q:vec2i)->vec2f {
 let v=textureLoad(velocity,clamp(q,vec2i(0),vec2i(p.size.xy)-1),0);
 if(v.a<0.02) { return vec2f(0); }
 return (v.xy/v.a-0.5)*p.size.w;
}`
const tileShader = `${quad}
struct P { size:vec4f }
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var velocity:texture_2d<f32>;
${decode}
@fragment fn tile(@builtin(position) position:vec4f)->@location(0) vec4f {
 let size=i32(p.size.z);
 let origin=vec2i(position.xy)*size;
 var best=vec2f(0); var length2=0.0;
 for(var y=0;y<size;y++) { for(var x=0;x<size;x++) {
  let v=velocityAt(origin+vec2i(x,y)); let d=dot(v,v);
  if(d>length2) { length2=d; best=v; }
 } }
 return vec4f(best,0,1);
}`
const neighborShader = `${quad}
@group(0) @binding(1) var tiles:texture_2d<f32>;
@fragment fn neighbor(@builtin(position) position:vec4f)->@location(0) vec4f {
 let here=vec2i(position.xy);
 let limit=vec2i(textureDimensions(tiles))-1;
 var best=vec2f(0); var length2=0.0;
 for(var y=-1;y<=1;y++) { for(var x=-1;x<=1;x++) {
  let v=textureLoad(tiles,clamp(here+vec2i(x,y),vec2i(0),limit),0).xy; let d=dot(v,v);
  if(d>length2) { length2=d; best=v; }
 } }
 return vec4f(best,0,1);
}`
const gatherShader = `${quad}
struct P { size:vec4f, taps:vec4f }
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var color:texture_2d<f32>;
@group(0) @binding(2) var velocity:texture_2d<f32>;
@group(0) @binding(3) var neighbors:texture_2d<f32>;
@group(0) @binding(4) var linearSampler:sampler;
${decode}
fn stepOf(total:f32)->f32 { return total/f32(clamp(i32(ceil(total/p.taps.y))+1,2,i32(p.taps.x))-1); }
/**
 * 沿一条线两头取样：附近可能有反向运动的内容。样本只有刚才正好从这个像素经过才算数，方向不同的样本不会被扫到不该去的地方。
 * 走得比取样间距还短的样本待在自己的像素上：间距大时再分摊，就成了隔开的两个半透明副本。
 */
fn line(here:vec2f, along:vec2f, total:f32, skipHere:bool)->vec4f {
 let step=stepOf(total);
 let reach=i32(round(total/step));
 var sum=vec4f(0);
 for(var i=-reach;i<=reach;i++) {
  if(skipHere&&i==0) { continue; }
  let q=here+along*(f32(i)*step);
  if(q.x<0.0||q.y<0.0||q.x>=p.size.x||q.y>=p.size.y) { continue; }
  let own=velocityAt(vec2i(q));
  let ownLength=length(own);
  if(ownLength<=0.5||ownLength<step) {
   if(i==0) { sum+=textureLoad(color,vec2i(q),0); }
   continue;
  }
  let direction=own/ownLength;
  let d=q-here;
  if(abs(d.x*direction.y-d.y*direction.x)>1.0+step*0.5) { continue; }
  let behind=dot(d,direction);
  // 样本的能量摊在它自己走过的路径上；梯形权重让任意步长下的总和都正好是 1。
  let covered=clamp(min(behind+step*0.5,ownLength+step*0.5-behind)/step,0.0,1.0);
  if(covered<=0.0) { continue; }
  sum+=textureSampleLevel(color,linearSampler,q/p.size.xy,0.0)*covered*step/ownLength;
 }
 return sum;
}
@fragment fn gather(@builtin(position) position:vec4f)->@location(0) vec4f {
 let here=position.xy;
 let tile=vec2i(here)/i32(p.size.z);
 let reach=textureLoad(neighbors,min(tile,vec2i(textureDimensions(neighbors))-1),0).xy;
 let total=length(reach);
 if(total<0.5) { return textureLoad(color,vec2i(here),0); }
 let along=reach/total;
 var sum=line(here,along,total,false);
 // 自己的方向和附近最快的不在一条线上时，再顺着自己的方向收一遍，否则自己的能量收不全。
 let own=velocityAt(vec2i(here));
 let ownLength=length(own);
 if(ownLength>=stepOf(total)&&ownLength>0.5&&abs(dot(own/ownLength,along))<0.97) { sum+=line(here,own/ownLength,ownLength,true); }
 return sum;
}`
const TILE_FORMAT = 'rgba16float'
const view = (texture: GpuTexture): unknown => texture.createView()
const firstLevel = (texture: GpuTexture): unknown => (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: 0, mipLevelCount: 1 })
type Pass = ReturnType<ReturnType<GpuDevice['createCommandEncoder']>['beginRenderPass']>

export interface AuthorExposureAllocator { allocate(width: number, height: number, format: string): GpuTexture; release(texture: GpuTexture): void }

export class VideoEditAuthorExposureGpu {
  private pipelines?: Promise<{ tile: GpuRenderPipeline; neighbor: GpuRenderPipeline; gather: GpuRenderPipeline }>
  private readonly sampler: unknown
  constructor(private readonly device: GpuDevice, private readonly allocator: AuthorExposureAllocator) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  }
  private prepare(): Promise<{ tile: GpuRenderPipeline; neighbor: GpuRenderPipeline; gather: GpuRenderPipeline }> {
    this.pipelines ??= (async () => {
      const make = (code: string, entry: string, format: string): Promise<GpuRenderPipeline> => {
        const module = this.device.createShaderModule({ code })
        const descriptor = { layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: entry, targets: [{ format }] }, primitive: { topology: 'triangle-list' } }
        return Promise.resolve(this.device.createRenderPipelineAsync?.(descriptor) ?? this.device.createRenderPipeline(descriptor))
      }
      const [tile, neighbor, gather] = await Promise.all([make(tileShader, 'tile', TILE_FORMAT), make(neighborShader, 'neighbor', TILE_FORMAT), make(gatherShader, 'gather', 'rgba8unorm')])
      return { tile, neighbor, gather }
    })()
    return this.pipelines
  }
  /**
   * `color` 预乘颜色；`velocity` 的 xy/a 是位移的编码（静止编码为 0.5，满量程 ±`range/2` 像素），a 是覆盖度。
   * `taps`：一个像素最多取几个样本；`spacing`：样本大约隔几个像素。结果写进 `target`（rgba8unorm，同尺寸）。
   */
  async encode(encoder: ReturnType<GpuDevice['createCommandEncoder']>, color: GpuTexture, velocity: GpuTexture, target: GpuTexture, size: { width: number; height: number }, range: number, longest: number, taps: number, spacing: number): Promise<void> {
    const { tile, neighbor, gather } = await this.prepare()
    // 分块边长盖住整条路径，3×3 邻域就覆盖了所有可能从这里经过的样本。
    const tileSize = Math.max(4, Math.ceil(longest) + 1)
    const tileWidth = Math.ceil(size.width / tileSize), tileHeight = Math.ceil(size.height / tileSize)
    const first = this.allocator.allocate(tileWidth, tileHeight, TILE_FORMAT), second = this.allocator.allocate(tileWidth, tileHeight, TILE_FORMAT)
    const uniforms = new Float32Array([size.width, size.height, tileSize, range, taps, spacing, 0, 0])
    const buffer = this.device.createBuffer({ size: 32, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(buffer, 0, uniforms)
    const run = (pipeline: GpuRenderPipeline, output: GpuTexture, resources: Array<{ binding: number; resource: unknown }>): void => {
      const pass: Pass = encoder.beginRenderPass({ colorAttachments: [{ view: firstLevel(output), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources }))
      pass.draw(6); pass.end()
    }
    run(tile, first, [{ binding: 0, resource: { buffer } }, { binding: 1, resource: view(velocity) }])
    run(neighbor, second, [{ binding: 1, resource: view(first) }])
    run(gather, target, [{ binding: 0, resource: { buffer } }, { binding: 1, resource: view(color) }, { binding: 2, resource: view(velocity) }, { binding: 3, resource: view(second) }, { binding: 4, resource: this.sampler }])
    this.frameResources.push(first, second, buffer)
  }
  private readonly frameResources: Array<GpuTexture | { destroy(): void }> = []
  /** 命令提交后再还；编码时还回去的纹理可能被同一帧后面的分配复用。 */
  release(): void {
    for (const resource of this.frameResources.splice(0)) {
      if ('createView' in resource) this.allocator.release(resource)
      else resource.destroy()
    }
  }
  dispose(): void { this.release(); this.pipelines = undefined }
}
