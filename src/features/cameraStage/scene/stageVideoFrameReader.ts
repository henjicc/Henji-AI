import { GLSL3, NearestFilter, RGBAFormat, RawShaderMaterial, UnsignedByteType, WebGLRenderTarget } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

/**
 * 视频帧读取：在显卡上把离屏成片（8 位 sRGB RGBA，自下而上）转成编码器直接要的 yuv420p，再异步读回。
 *
 * - 数据量只有 RGBA 的 3/8，渲染层到主进程的复制与 IPC 随之缩小，主进程也不再逐帧做 vflip 与色彩转换。
 * - 转换与此前 FFmpeg 的 `scale=in_range=full:out_range=limited:out_color_matrix=bt709` 同一规格：
 *   BT.709 矩阵、全范围转有限范围；色度取 2×2 均值。传递函数不变，输出继续标 sRGB。
 * - 读回走 WebGL2 像素缓冲 + fence：读请求排进显卡队列后立即返回，调用方可以先去提交下一帧，
 *   等显卡做完再取数据，不让渲染线程同步等显卡。像素缓冲按帧复用，不逐帧分配 GPU 内存。
 */

/** 每帧 yuv420p 字节数：Y 平面 width×height，U、V 各 (width/2)×(height/2)。 */
export function yuv420pFrameByteLength(width: number, height: number): number {
  return width * height * 3 / 2
}

const VERTEX_SHADER = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/*
 * 打包目标宽 width/2 个像素，每像素 4 字节，按行优先恰好是读回内存的字节顺序；
 * 每个输出字节按全局下标 p 落到 Y / U / V 平面里对应的位置，任意偶数宽高都适用，末尾不足一行的部分补零。
 */
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D source;
uniform int width;
uniform int height;
uniform int packedWidth;
out vec4 fragColor;

const vec3 KY = vec3(0.2126, 0.7152, 0.0722);
const vec3 KU = vec3(-0.2126 / 1.8556, -0.7152 / 1.8556, 0.5);
const vec3 KV = vec3(0.5, -0.7152 / 1.5748, -0.0722 / 1.5748);

// 源纹理第 0 行在画面底部，编码器要自上而下。
vec3 pixel(int x, int y) { return texelFetch(source, ivec2(x, height - 1 - y), 0).rgb; }

vec3 chromaSource(int index) {
  int chromaWidth = width / 2;
  int x = (index % chromaWidth) * 2;
  int y = (index / chromaWidth) * 2;
  return (pixel(x, y) + pixel(x + 1, y) + pixel(x, y + 1) + pixel(x + 1, y + 1)) * 0.25;
}

float byteAt(int p) {
  int lumaSize = width * height;
  int chromaSize = lumaSize / 4;
  float value;
  if (p < lumaSize) value = 16.0 + 219.0 * dot(pixel(p % width, p / width), KY);
  else if (p < lumaSize + chromaSize) value = 128.0 + 224.0 * dot(chromaSource(p - lumaSize), KU);
  else if (p < lumaSize + chromaSize * 2) value = 128.0 + 224.0 * dot(chromaSource(p - lumaSize - chromaSize), KV);
  else return 0.0;
  return clamp(floor(value + 0.5), 0.0, 255.0) / 255.0;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int base = (texel.y * packedWidth + texel.x) * 4;
  fragColor = vec4(byteAt(base), byteAt(base + 1), byteAt(base + 2), byteAt(base + 3));
}
`

export class StageVideoFrameReader {
  readonly width: number
  readonly height: number
  readonly byteLength: number
  private readonly packedWidth: number
  private readonly packedHeight: number
  private readonly target: WebGLRenderTarget
  private readonly material: RawShaderMaterial
  private readonly quad: FullScreenQuad
  private readonly idleBuffers: WebGLBuffer[] = []
  private gl: WebGL2RenderingContext | null = null
  private disposed = false

  constructor(width: number, height: number) {
    if (width % 2 !== 0 || height % 2 !== 0) throw new Error('[cameraStage] yuv420p 视频帧的宽高必须为偶数')
    this.width = width
    this.height = height
    this.byteLength = yuv420pFrameByteLength(width, height)
    this.packedWidth = width / 2
    this.packedHeight = Math.ceil(this.byteLength / (this.packedWidth * 4))
    this.target = new WebGLRenderTarget(this.packedWidth, this.packedHeight, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    })
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        source: { value: null },
        width: { value: width },
        height: { value: height },
        packedWidth: { value: this.packedWidth },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
  }

  /**
   * 同步完成转换并把读请求排进显卡队列，返回的 Promise 在数据写进 into 后兑现。
   * 调用方在兑现前不得复用 into；source 可以立即被下一帧覆盖（显卡按提交顺序执行）。
   */
  read(renderer: WebGLRenderer, source: Texture, into: Uint8Array): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('[cameraStage] 视频帧读取器已释放'))
    if (into.byteLength !== this.byteLength) {
      return Promise.reject(new Error(`[cameraStage] 视频帧缓冲大小不符：需要 ${this.byteLength}，实际 ${into.byteLength}`))
    }
    const gl = renderer.getContext() as WebGL2RenderingContext
    this.gl = gl
    this.material.uniforms.source.value = source
    renderer.setRenderTarget(this.target)
    this.quad.render(renderer)

    const buffer = this.idleBuffers.pop() ?? this.createPackBuffer(gl)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
    gl.readPixels(0, 0, this.packedWidth, this.packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (!sync) {
      this.releaseBuffer(buffer)
      return Promise.reject(new Error('[cameraStage] 无法创建显卡同步对象'))
    }
    gl.flush()

    return waitForSync(gl, sync).then(() => {
      if (this.disposed) throw new Error('[cameraStage] 视频帧读取器已释放')
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, into, 0, this.byteLength)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      return into
    }).finally(() => {
      gl.deleteSync(sync)
      this.releaseBuffer(buffer)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const buffer of this.idleBuffers) this.gl?.deleteBuffer(buffer)
    this.idleBuffers.length = 0
    this.target.dispose()
    this.material.dispose()
    this.quad.dispose()
  }

  private createPackBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('[cameraStage] 无法创建像素读回缓冲')
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.packedWidth * this.packedHeight * 4, gl.STREAM_READ)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return buffer
  }

  private releaseBuffer(buffer: WebGLBuffer): void {
    if (this.disposed) this.gl?.deleteBuffer(buffer)
    else this.idleBuffers.push(buffer)
  }
}

/**
 * WebGL 的 fence 状态只在让出事件循环后更新，所以每查一次就让出一个任务，不能在同一任务里空转。
 * 用 MessageChannel 而不是 setTimeout 让出：窗口最小化或被遮住时计时器会被节流到每秒一次，导出会被拖到每秒几帧。
 */
async function waitForSync(gl: WebGL2RenderingContext, sync: WebGLSync): Promise<void> {
  for (;;) {
    await nextTask()
    const status = gl.clientWaitSync(sync, 0, 0)
    if (status === gl.WAIT_FAILED) throw new Error('[cameraStage] 等待显卡读回失败')
    if (status !== gl.TIMEOUT_EXPIRED) return
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
