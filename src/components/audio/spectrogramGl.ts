import { buildSpectrumTexture } from '@/core/audio/spectrogramTexture'
import type { SpectrogramData, SpectrogramRasterRequest } from '@/core/audio/spectrogram'

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray spectrum;
uniform sampler2D lut;
uniform ivec3 packing;
uniform ivec3 levels[32];
uniform int levelCount;
uniform int channelBase;
uniform vec4 timeRange;
uniform vec4 frequency;
uniform vec3 viewportSize;
uniform float boost;
out vec4 color;
float hz(float p) {
  if (frequency.z == 0.0) return mix(frequency.x, frequency.y, p);
  float low = max(20.0, frequency.x);
  return exp(mix(log(low), log(max(low * 1.0001, frequency.y)), p));
}
float sampleAt(int frame, int bin, int level) {
  ivec3 m = levels[level];
  int address = channelBase + m.x + frame * m.z + bin;
  return texelFetch(spectrum, ivec3(address % packing.x, (address / packing.x) % packing.y, address / (packing.x * packing.y)), 0).r;
}
void main() {
  float x = floor(gl_FragCoord.x);
  float y = floor(gl_FragCoord.y - viewportSize.z);
  float first = floor((timeRange.x + timeRange.y * x / viewportSize.x - timeRange.z) / timeRange.w);
  float last = max(first, ceil((timeRange.x + timeRange.y * (x + 1.0) / viewportSize.x - timeRange.z) / timeRange.w) - 1.0);
  if (last < 0.0 || first >= float(levels[0].y)) { color = texelFetch(lut, ivec2(0), 0); return; }
  first = max(0.0, first); last = min(float(levels[0].y - 1), last);
  float low = clamp(floor(hz(y / viewportSize.y) / frequency.w), 0.0, float(levels[0].z - 1));
  float highHz = hz((y + 1.0) / viewportSize.y) / frequency.w;
  float high = clamp(y == viewportSize.y - 1.0 ? floor(highHz) : ceil(highHz) - 1.0, low, float(levels[0].z - 1));
  int level = int(clamp(ceil(log2(max(last - first + 1.0, high - low + 1.0) / 7.0)), 0.0, float(levelCount - 1)));
  float divisor = exp2(float(level));
  ivec2 begin = ivec2(floor(vec2(first, low) / divisor));
  ivec2 end = ivec2(floor(vec2(last, high) / divisor));
  float peak = 0.0;
  for (int t = 0; t < 8; t++) {
    if (begin.x + t > end.x) break;
    for (int b = 0; b < 8; b++) {
      if (begin.y + b > end.y) break;
      peak = max(peak, sampleAt(begin.x + t, begin.y + b, level));
    }
  }
  color = texelFetch(lut, ivec2(int(clamp(round(peak * 255.0) + boost, 0.0, 255.0)), 0), 0);
}`

export interface SpectrogramGl {
  upload(data: SpectrogramData): void
  draw(request: SpectrogramRasterRequest, bottom: number): void
  clear(): void
  dispose(): void
}

/** 上传与绘制分离：draw 只更新 uniform/viewport 并提交一个三角形。 */
export function createSpectrogramGl(gl: WebGL2RenderingContext, lut: Uint8ClampedArray): SpectrogramGl {
  const shaders: WebGLShader[] = [], textures: WebGLTexture[] = []
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建频谱绘制程序')
  const dispose = (): void => { textures.forEach(texture => gl.deleteTexture(texture)); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program) }
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('无法创建频谱着色器')
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? '频谱着色器编译失败')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '频谱程序链接失败')
    gl.useProgram(program)
    const locations = new Map<string, WebGLUniformLocation | null>()
    const uniform = (name: string): WebGLUniformLocation | null => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
      return locations.get(name) ?? null
    }
    const texture = (unit: number, target: number): void => {
      const result = gl.createTexture()
      if (!result) throw new Error('无法创建频谱纹理')
      textures.push(result); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, result)
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    texture(0, gl.TEXTURE_2D_ARRAY); texture(1, gl.TEXTURE_2D)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(lut.buffer, lut.byteOffset, lut.byteLength))
    gl.uniform1i(uniform('spectrum'), 0); gl.uniform1i(uniform('lut'), 1)
    let data: SpectrogramData | undefined, stride = 0
    return {
      upload(next) {
        if (data === next) return
        const packed = buildSpectrumTexture(next, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number)
        gl.activeTexture(gl.TEXTURE0)
        gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, packed.width, packed.height, packed.layers, 0, gl.RED, gl.UNSIGNED_BYTE, packed.values)
        if (gl.getError() !== gl.NO_ERROR) throw new Error('频谱纹理上传失败')
        gl.uniform3i(uniform('packing'), packed.width, packed.height, packed.layers)
        gl.uniform3iv(uniform('levels[0]'), new Int32Array(packed.levels.flatMap(level => [level.offset, level.frames, level.bins])))
        gl.uniform1i(uniform('levelCount'), packed.levels.length)
        stride = packed.channelStride; data = next
      },
      draw(request, bottom) {
        if (!data) return
        gl.viewport(0, bottom, request.width, request.height)
        gl.uniform1i(uniform('channelBase'), Math.min(data.channelCount - 1, Math.max(0, request.channel)) * stride)
        gl.uniform4f(uniform('timeRange'), request.startFrame - data.startFrame, request.endFrame - request.startFrame, 0, data.hop)
        gl.uniform4f(uniform('frequency'), request.minHz, request.maxHz, request.scale === 'log' ? 1 : 0, data.sampleRate / data.fftSize)
        gl.uniform3f(uniform('viewportSize'), request.width, request.height, bottom)
        gl.uniform1f(uniform('boost'), Math.round(request.boost ?? 0))
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      },
      clear: () => gl.clear(gl.COLOR_BUFFER_BIT), dispose,
    }
  } catch (error) { dispose(); throw error }
}
