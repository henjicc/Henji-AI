/// <reference types="@webgpu/types" />
/**
 * The replay's frame reader: runs in a hidden window of its own (sandboxed, an empty page). The engine
 * hands it each captured frame as a GPU shared texture. With WebGPU the reader checks the frame's capture
 * token, compares the picture with the last accepted one tile by tile, and copies back only the tiles
 * that changed, already converted to NV12 for the encoder (milliseconds even at 4K). No full frame goes
 * through the browser's slow CPU paint path, and a frame where only some text changed costs a few
 * hundred kilobytes instead of 38 MB.
 */
import { ipcRenderer, sharedTexture } from 'electron'
import { CAPTURE_TOKEN_COLORS, READER_TILE, type ReaderRequest, type ReaderResult } from '../../packages/web-replay-probe/src/replay/types'

const T = READER_TILE
const SHADER = /* wgsl */ `
struct Params { width: u32, height: u32, tilesX: u32, guard: u32, count: u32 }
@group(0) @binding(0) var<uniform> params: Params;

// 1) The frame as B, G, R, A bytes (the encoder's layout).
@group(1) @binding(0) var src: texture_external;
@group(1) @binding(1) var cur: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(16, 16)
fn copyFrame(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let c = textureLoad(src, id.xy);
  textureStore(cur, id.xy, vec4<f32>(c.b, c.g, c.r, c.a));
}

// 2) Tiles that differ from the last accepted frame; the token square in the corner never counts.
@group(1) @binding(0) var now: texture_2d<f32>;
@group(1) @binding(1) var before: texture_2d<f32>;
@group(1) @binding(2) var<storage, read_write> flags: array<atomic<u32>>;
@compute @workgroup_size(16, 16)
fn diffTiles(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  if (id.x < params.guard && id.y < params.guard) { return; }
  let a = textureLoad(now, id.xy, 0);
  let b = textureLoad(before, id.xy, 0);
  if (any(a != b)) { atomicStore(&flags[(id.y / ${T}u) * params.tilesX + id.x / ${T}u], 1u); }
}

// 3) The listed tiles packed one after another as NV12 (BT.601, limited range: the matrix NVENC applies
//    to BGRA and the one the video is tagged with): the tile's Y rows, then its interleaved U, V rows.
//    One invocation converts a 4 x 2 block: two words of Y and one word of U, V, V, U pairs.
@group(1) @binding(0) var frame: texture_2d<f32>;
@group(1) @binding(1) var<storage, read> tiles: array<u32>;
@group(1) @binding(2) var<storage, read_write> packed: array<u32>;
fn rgbAt(x: u32, y: u32) -> vec3<f32> {
  // Stored as B, G, R, A; edge tiles repeat the last column and row.
  let c = textureLoad(frame, vec2<u32>(min(x, params.width - 1u), min(y, params.height - 1u)), 0);
  return vec3<f32>(c.b, c.g, c.r);
}
fn luma(c: vec3<f32>) -> u32 { return u32(clamp(round(16.0 + 65.481 * c.r + 128.553 * c.g + 24.966 * c.b), 0.0, 255.0)); }
fn chroma(c: vec3<f32>) -> vec2<u32> {
  let u = clamp(round(128.0 - 37.797 * c.r - 74.203 * c.g + 112.0 * c.b), 0.0, 255.0);
  let v = clamp(round(128.0 + 112.0 * c.r - 93.786 * c.g - 18.214 * c.b), 0.0, 255.0);
  return vec2<u32>(u32(u), u32(v));
}
@compute @workgroup_size(16, 16)
fn gatherTiles(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.z;
  if (k >= params.count || id.x >= ${T / 4}u || id.y >= ${T / 2}u) { return; }
  let tile = tiles[k];
  let x = (tile % params.tilesX) * ${T}u + id.x * 4u;
  let y = (tile / params.tilesX) * ${T}u + id.y * 2u;
  let base = k * ${(T * T * 3) / 8}u;
  var top = 0u;
  var bottom = 0u;
  var uv = 0u;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let a = rgbAt(x + i, y);
    let b = rgbAt(x + i, y + 1u);
    top = top | (luma(a) << (8u * i));
    bottom = bottom | (luma(b) << (8u * i));
  }
  for (var j = 0u; j < 2u; j = j + 1u) {
    let avg = (rgbAt(x + 2u * j, y) + rgbAt(x + 2u * j + 1u, y) + rgbAt(x + 2u * j, y + 1u) + rgbAt(x + 2u * j + 1u, y + 1u)) * 0.25;
    let c = chroma(avg);
    uv = uv | (c.x << (16u * j)) | (c.y << (16u * j + 8u));
  }
  packed[base + (id.y * 2u) * ${T / 4}u + id.x] = top;
  packed[base + (id.y * 2u + 1u) * ${T / 4}u + id.x] = bottom;
  packed[base + ${(T * T) / 4}u + id.y * ${T / 4}u + id.x] = uv;
}

// BT.709 limited 保留每个像素的色度；以 sRGB 编码值计算，不再施加传递函数。
@compute @workgroup_size(16, 16)
fn gatherPlanar(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.z;
  if (k >= params.count || id.x >= ${T / 4}u || id.y >= ${T}u) { return; }
  let tile = tiles[k];
  let x = (tile % params.tilesX) * ${T}u + id.x * 4u;
  let y = (tile / params.tilesX) * ${T}u + id.y;
  var yy = 0u;
  var uu = 0u;
  var vv = 0u;
  for (var i = 0u; i < 4u; i++) {
    let c = rgbAt(x + i, y);
    let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    let values = vec3<u32>(clamp(round(vec3<f32>(16.0 + 219.0 * l,
      128.0 + 112.0 * (c.b - l) / 0.9278,
      128.0 + 112.0 * (c.r - l) / 0.7874)), vec3<f32>(0.0), vec3<f32>(255.0)));
    yy |= values.x << (8u * i);
    uu |= values.y << (8u * i);
    vv |= values.z << (8u * i);
  }
  let base = k * ${T * T * 3 / 4}u + id.y * ${T / 4}u + id.x;
  packed[base] = yy;
  packed[base + ${T * T / 4}u] = uu;
  packed[base + ${T * T / 2}u] = vv;
}`

function tokenOf(b: number, g: number, r: number): number {
  return CAPTURE_TOKEN_COLORS.findIndex(color => Math.abs(color[0] - r) <= 40 && Math.abs(color[1] - g) <= 40 && Math.abs(color[2] - b) <= 40)
}

interface Gpu { device: GPUDevice; copy: GPUComputePipeline; diff: GPUComputePipeline; gather: GPUComputePipeline; planar: GPUComputePipeline }

export function installReplayReader(): void {
  let gpu: Gpu | null = null
  /** The current frame and the last accepted one; they swap when a frame is accepted. */
  let frames: { cur: GPUTexture; prev: GPUTexture; width: number; height: number } | null = null
  const buffers = new Map<string, GPUBuffer>()
  const buffer = (key: string, size: number, usage: number): GPUBuffer => {
    const existing = buffers.get(key)
    if (existing && existing.size >= size) return existing
    existing?.destroy()
    const created = gpu!.device.createBuffer({ size: Math.max(256, Math.ceil(size / 256) * 256), usage })
    buffers.set(key, created)
    return created
  }
  const ready = (async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('WebGPU 不可用')
    const device = await adapter.requestDevice()
    const module = device.createShaderModule({ code: SHADER })
    const problems = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error')
    if (problems.length) throw new Error(`取帧着色器编译失败：${problems.map(message => message.message).join('；')}`)
    const pipeline = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
    gpu = { device, copy: pipeline('copyFrame'), diff: pipeline('diffTiles'), gather: pipeline('gatherTiles'), planar: pipeline('gatherPlanar') }
  })()
  ready.then(() => ipcRenderer.send('web-replay:reader-ready', { ok: true }), error => ipcRenderer.send('web-replay:reader-ready', { ok: false, error: String(error) }))

  const frameTextures = (width: number, height: number): NonNullable<typeof frames> => {
    if (frames && frames.width === width && frames.height === height) return frames
    frames?.cur.destroy()
    frames?.prev.destroy()
    const make = (): GPUTexture => gpu!.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST })
    frames = { cur: make(), prev: make(), width, height }
    return frames
  }

  const read = async (importedSharedTexture: Electron.SharedTextureImported, request: ReaderRequest): Promise<ReaderResult> => {
    await ready
    const { device, copy, diff } = gpu!
    const planar = request.format === 'yuv444p'
    const gather = planar ? gpu!.planar : gpu!.gather
    const started = performance.now()
    // 原生窗口的 DIP 换算可能让纹理多出边缘像素：按快照的输出尺寸取帧视图，不缩放像素。
    // 隔离 preload 与应用 preload 分开打包、不能共用模块（沙箱 preload 不能加载拆出的共享文件），这里直接构造。
    const original = importedSharedTexture.getVideoFrame() as VideoFrame
    const video = request.snapshot ? new VideoFrame(original, { displayWidth: request.snapshot.width, displayHeight: request.snapshot.height }) : original
    if (video !== original) original.close()
    let released = false
    const release = (): void => { if (!released) { released = true; video.close(); importedSharedTexture.release() } }
    try {
      const sourceWidth = video.visibleRect?.width ?? video.codedWidth
      const sourceHeight = video.visibleRect?.height ?? video.codedHeight
      const snapshot = request.snapshot
      const width = snapshot?.width ?? sourceWidth, height = snapshot?.height ?? sourceHeight
      if (snapshot && (!/^[0-9a-f]{32}$/.test(snapshot.identity) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 8 || height < 4 || sourceWidth !== width || sourceHeight !== height || snapshot.restore.length !== 1024 ||
        !snapshot.restore.every(value => Number.isInteger(value) && value >= 0 && value <= 255))) throw new Error('网页快照身份区或尺寸不匹配')
      const resized = !frames || frames.width !== sourceWidth || frames.height !== sourceHeight
      const { cur, prev } = frameTextures(sourceWidth, sourceHeight)
      const tilesX = Math.ceil(width / T), tileCount = tilesX * Math.ceil(height / T)
      const full = !!snapshot || request.full || resized
      const params = buffer('params', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
      device.queue.writeBuffer(params, 0, new Uint32Array([width, height, tilesX, request.guard, 0, 0, 0, 0]))
      const flags = buffer('flags', tileCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST)
      const flagsRead = buffer('flagsRead', tileCount * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
      const guardBytes = snapshot ? 1024 : 256
      const tokenRead = buffer('tokenRead', guardBytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
      device.pushErrorScope('validation')
      const encoder = device.createCommandEncoder()
      let pass = encoder.beginComputePass()
      pass.setPipeline(copy)
      pass.setBindGroup(0, device.createBindGroup({ layout: copy.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }] }))
      pass.setBindGroup(1, device.createBindGroup({ layout: copy.getBindGroupLayout(1), entries: [{ binding: 0, resource: device.importExternalTexture({ source: video }) }, { binding: 1, resource: cur.createView() }] }))
      pass.dispatchWorkgroups(Math.ceil(sourceWidth / 16), Math.ceil(sourceHeight / 16))
      pass.end()
      encoder.copyTextureToBuffer({ texture: cur }, { buffer: tokenRead, bytesPerRow: 256 }, snapshot ? [8, 4] : [1, 1])
      if (!full) {
        encoder.clearBuffer(flags, 0, flags.size)
        pass = encoder.beginComputePass()
        pass.setPipeline(diff)
        pass.setBindGroup(0, device.createBindGroup({ layout: diff.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }] }))
        pass.setBindGroup(1, device.createBindGroup({ layout: diff.getBindGroupLayout(1), entries: [{ binding: 0, resource: cur.createView() }, { binding: 1, resource: prev.createView() }, { binding: 2, resource: { buffer: flags } }] }))
        pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16))
        pass.end()
        encoder.copyBufferToBuffer(flags, 0, flagsRead, 0, tileCount * 4)
      }
      device.queue.submit([encoder.finish()])
      const invalid = await device.popErrorScope()
      if (invalid) throw new Error(`WebGPU 取帧出错：${invalid.message}`)
      await tokenRead.mapAsync(GPUMapMode.READ, 0, guardBytes)
      // The shared texture is copied into `cur` once the queue got this far; give it back right away.
      release()
      const px = new Uint8Array(tokenRead.getMappedRange(0, guardBytes)).slice()
      tokenRead.unmap()
      const guardMs = performance.now() - started
      const token = tokenOf(px[0], px[1], px[2])
      const guardMatched = snapshot ? [...snapshot.identity].every((digit, i) => {
        const offset = Math.floor(i / 8) * 256 + (i % 8) * 4, expected = parseInt(digit, 16) * 17
        return [0, 1, 2].every(channel => Math.abs(px[offset + channel] - expected) <= 2) && px[offset + 3] >= 253
      }) : undefined
      if (guardMatched === false) return { id: request.id, ok: true, token, width, height, guardMatched, tiles: null, pixels: null, timings: { guardMs, pixelsMs: 0 } }
      if (snapshot) {
        // cur 按既有 reader 约定保存 BGRA 通道；恢复必须在转换及差异比较前完成。
        const restore = Uint8Array.from(snapshot.restore)
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
          const i = y * 256 + x * 4, r = restore[i]
          restore[i] = restore[i + 2]; restore[i + 2] = r
        }
        device.queue.writeTexture({ texture: cur }, restore, { bytesPerRow: 256 }, [8, 4])
      }
      if (request.token !== null && token !== request.token) return { id: request.id, ok: true, token, width, height, tiles: null, pixels: null }
      let list: number[]
      if (full) list = Array.from({ length: tileCount }, (_, k) => k)
      else {
        await flagsRead.mapAsync(GPUMapMode.READ, 0, tileCount * 4)
        const changed = new Uint32Array(flagsRead.getMappedRange(0, tileCount * 4))
        list = []
        for (let k = 0; k < tileCount; k += 1) if (changed[k]) list.push(k)
        flagsRead.unmap()
      }
      if (!list.length) return { id: request.id, ok: true, token, width, height, tiles: new Uint32Array(0), pixels: null }
      const tiles = new Uint32Array(list)
      const tileList = buffer('tiles', tiles.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
      device.queue.writeBuffer(tileList, 0, tiles)
      device.queue.writeBuffer(params, 16, new Uint32Array([tiles.length]))
      const pixelsStarted = performance.now()
      const bytes = tiles.length * T * T * (planar ? 3 : 1.5)
      const packed = buffer('packed', bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
      const packedRead = buffer('packedRead', bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
      device.pushErrorScope('validation')
      const gathering = device.createCommandEncoder()
      const gatherPass = gathering.beginComputePass()
      gatherPass.setPipeline(gather)
      gatherPass.setBindGroup(0, device.createBindGroup({ layout: gather.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: params } }] }))
      gatherPass.setBindGroup(1, device.createBindGroup({ layout: gather.getBindGroupLayout(1), entries: [{ binding: 0, resource: cur.createView() }, { binding: 1, resource: { buffer: tileList, size: tiles.byteLength } }, { binding: 2, resource: { buffer: packed, size: bytes } }] }))
      gatherPass.dispatchWorkgroups(1, Math.ceil(T / (planar ? 1 : 2) / 16), tiles.length)
      gatherPass.end()
      gathering.copyBufferToBuffer(packed, 0, packedRead, 0, bytes)
      device.queue.submit([gathering.finish()])
      const failed = await device.popErrorScope()
      if (failed) throw new Error(`WebGPU 取帧出错：${failed.message}`)
      await packedRead.mapAsync(GPUMapMode.READ, 0, bytes)
      const pixels = new Uint8Array(packedRead.getMappedRange(0, bytes).slice(0))
      packedRead.unmap()
      // Accepted: this frame is what the next one is compared with.
      frames = { cur: prev, prev: cur, width: sourceWidth, height: sourceHeight }
      return { id: request.id, ok: true, token, width, height, guardMatched, tiles, pixels, timings: { guardMs, pixelsMs: performance.now() - pixelsStarted } }
    } finally {
      release()
    }
  }

  let tail = Promise.resolve()
  sharedTexture.setSharedTextureReceiver(({ importedSharedTexture }, request: ReaderRequest) => {
    // 一个 reader 共用映射缓冲与上一帧；异步接收不能并发覆盖另一张尚未读完的纹理。
    tail = tail.then(async () => {
      try {
        ipcRenderer.send('web-replay:reader-result', await read(importedSharedTexture, request))
      } catch (error) {
        try { importedSharedTexture.release() } catch { /* released */ }
        ipcRenderer.send('web-replay:reader-result', { id: request.id, ok: false, error: String(error) } satisfies ReaderResult)
      }
    })
    return tail
  })
}
