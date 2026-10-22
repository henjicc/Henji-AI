import { SPECTRAL_CROSSOVER_END_HZ, SPECTRAL_CROSSOVER_START_HZ, SPECTRAL_TILE_COLUMNS, spectralHop, spectralOrigin, type AudioEditSpectralTile } from '@/core/audioEdit/spectralPyramid'
import { SPECTROGRAM_MIN_LOG_HZ } from '@/core/audio/spectrogram'
import { planSpectralDraws, spectralBands, SPECTRAL_BIN_SAMPLES, SPECTRAL_PEAK_WEIGHT, SPECTRAL_TIME_SAMPLES, type SpectralRasterRequest, type SpectralTileSet } from '@/core/audio/spectralTiles'

/** 常驻显存的块槽数（每块每声道占一槽）。约 1230 频点 × 1024 列 × 2 字节 × 48 ≈ 120 MB。 */
export const SPECTRAL_GPU_SLOTS = 48

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
// 与 core/audio/spectralTiles.ts 的 sampleSpectralPixel 逐条对应。
const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray spectrum;
uniform sampler2D lut;
uniform float textureWidth;
uniform ivec3 slots;
uniform ivec3 columns;
uniform vec2 timing;
uniform vec4 frequency;
uniform vec4 bands;
uniform ivec2 binCounts;
uniform vec3 viewportSize;
uniform float boost;
uniform float lowWeight;
out vec4 color;
float hz(float p) {
  if (frequency.z == 0.0) return mix(frequency.x, frequency.y, p);
  float low = max(${SPECTROGRAM_MIN_LOG_HZ}.0, frequency.x);
  return exp(mix(log(low), log(max(low * 1.0001, frequency.y)), p));
}
vec2 texel(int column, float x) {
  int c = clamp(column, slots.x >= 0 ? -${SPECTRAL_TILE_COLUMNS} : 0, columns.y + (slots.z >= 0 ? columns.z : 0) - 1);
  int slot = slots.y, row = c;
  if (c < 0) { slot = slots.x; row = c + ${SPECTRAL_TILE_COLUMNS}; }
  else if (c >= columns.y) { slot = slots.z; row = c - columns.y; }
  return texture(spectrum, vec3((x + 0.5) / textureWidth, (float(row) + 0.5) / ${SPECTRAL_TILE_COLUMNS}.0, float(slot))).rg * 255.0;
}
vec2 bilinear(float y, float first, int bins, float x) {
  float cx = first + clamp(x, 0.0, float(bins - 1));
  float y0 = floor(y);
  return mix(texel(int(y0), cx), texel(int(y0) + 1, cx), y - y0);
}
float power(float value) { return pow(10.0, (value / 255.0 * 120.0 - 120.0) / 10.0); }
float band(float u0, float u1, float first, int bins, float binHz, float lowHz, float highHz, float centerHz) {
  float x0 = lowHz / binHz, x1 = highHz / binHz;
  int timeCount = u1 - u0 <= 1.0 ? 1 : min(${SPECTRAL_TIME_SAMPLES}, int(ceil(u1 - u0)));
  int binCount = x1 - x0 <= 1.0 ? 1 : min(${SPECTRAL_BIN_SAMPLES}, int(ceil(x1 - x0)));
  float peak = 0.0, energy = 0.0, weight = 0.0;
  for (int t = 0; t < ${SPECTRAL_TIME_SAMPLES}; t++) {
    if (t >= timeCount) break;
    float y = (timeCount == 1 ? (u0 + u1) / 2.0 : u0 + (float(t) + 0.5) * (u1 - u0) / float(timeCount)) - 0.5;
    for (int b = 0; b < ${SPECTRAL_BIN_SAMPLES}; b++) {
      if (b >= binCount) break;
      float x = binCount == 1 ? centerHz / binHz : x0 + (float(b) + 0.5) * (x1 - x0) / float(binCount);
      vec2 value = bilinear(y, first, bins, x);
      peak = max(peak, value.r);
      energy += power(value.g);
      weight += 1.0;
    }
  }
  float mean = clamp((10.0 * log(max(1e-12, energy / weight)) / log(10.0) + 120.0) * 255.0 / 120.0, 0.0, 255.0);
  return mix(mean, peak, ${SPECTRAL_PEAK_WEIGHT});
}
void main() {
  float x = floor(gl_FragCoord.x);
  float y = floor(gl_FragCoord.y - viewportSize.z);
  float u0 = timing.x + x * timing.y, u1 = u0 + timing.y;
  float lowHz = hz(y / viewportSize.y);
  float highHz = y == viewportSize.y - 1.0 ? (frequency.z == 0.0 ? frequency.y : max(max(${SPECTROGRAM_MIN_LOG_HZ}.0, frequency.x) * 1.0001, frequency.y)) : hz((y + 1.0) / viewportSize.y);
  float centerHz = hz((y + 0.5) / viewportSize.y);
  float t = 1.0 - (1.0 - smoothstep(${SPECTRAL_CROSSOVER_START_HZ}.0, ${SPECTRAL_CROSSOVER_END_HZ}.0, centerHz)) * lowWeight;
  float value = t >= 1.0 ? band(u0, u1, bands.z, binCounts.y, bands.w, lowHz, highHz, centerHz)
    : t <= 0.0 ? band(u0, u1, bands.x, binCounts.x, bands.y, lowHz, highHz, centerHz)
    : mix(band(u0, u1, bands.x, binCounts.x, bands.y, lowHz, highHz, centerHz), band(u0, u1, bands.z, binCounts.y, bands.w, lowHz, highHz, centerHz), t);
  color = texelFetch(lut, ivec2(int(clamp(floor(value + 0.5) + boost, 0.0, 255.0)), 0), 0);
}`

export interface SpectrogramGl {
  /** 画一条声道泳道；底边在画布像素 bottom 处。 */
  draw(tiles: SpectralTileSet, request: SpectralRasterRequest, bottom: number): void
  clear(): void
  dispose(): void
}

interface Slot { key: string; tile?: AudioEditSpectralTile; used: number }

/** 块按槽常驻：只有新块或被替换的块才上传，绘制只改 uniform 并按块剪裁画一个三角形。 */
export function createSpectrogramGl(gl: WebGL2RenderingContext, lut: Uint8ClampedArray): SpectrogramGl {
  const shaders: WebGLShader[] = [], textures: WebGLTexture[] = []
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建频谱绘制程序')
  let spectrum: WebGLTexture | null = null
  const dispose = (): void => { textures.forEach(texture => gl.deleteTexture(texture)); if (spectrum) gl.deleteTexture(spectrum); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program) }
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
    const lutTexture = gl.createTexture()
    if (!lutTexture) throw new Error('无法创建频谱纹理')
    textures.push(lutTexture)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(lut.buffer, lut.byteOffset, lut.byteLength))
    gl.uniform1i(uniform('spectrum'), 0); gl.uniform1i(uniform('lut'), 1)
    gl.clearColor(lut[0] / 255, lut[1] / 255, lut[2] / 255, 1)

    let width = 0, frame = 0
    const slots: Slot[] = Array.from({ length: SPECTRAL_GPU_SLOTS }, () => ({ key: '', used: -1 }))
    const allocate = (bins: number): void => {
      if (spectrum) gl.deleteTexture(spectrum)
      spectrum = gl.createTexture()
      if (!spectrum) throw new Error('无法创建频谱纹理')
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, spectrum)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RG8, bins, SPECTRAL_TILE_COLUMNS, SPECTRAL_GPU_SLOTS)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('频谱纹理分配失败')
      width = bins
      gl.uniform1f(uniform('textureWidth'), bins)
      slots.forEach(slot => { slot.key = ''; delete slot.tile; slot.used = -1 })
    }
    /** 找到或上传某块某声道所在的槽；本帧已用的槽不会被挤掉，槽不够时返回 -1。 */
    const slotOf = (tile: AudioEditSpectralTile, channel: number): number => {
      const key = `${tile.mode}|${tile.revision}|${tile.level}|${tile.tile}|${channel}`
      let index = slots.findIndex(slot => slot.key === key)
      if (index >= 0 && slots[index].tile === tile) { slots[index].used = frame; return index }
      if (index < 0) {
        index = -1
        for (let i = 0; i < slots.length; i++) if (slots[i].used < frame && (index < 0 || slots[i].used < slots[index].used)) index = i
        if (index < 0) return -1
      }
      const bins = tile.lowBins + tile.highBins, size = tile.columnCount * bins * 2
      gl.activeTexture(gl.TEXTURE0)
      if (tile.columnCount > 0) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, bins, tile.columnCount, 1, gl.RG, gl.UNSIGNED_BYTE, tile.values.subarray(channel * size, (channel + 1) * size))
      slots[index] = { key, tile, used: frame }
      return index
    }
    return {
      draw(tiles, request, bottom) {
        frame++
        const bins = tiles.lowBins + tiles.highBins
        if (bins <= 0) return
        if (bins !== width) allocate(bins)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, spectrum)
        gl.viewport(0, bottom, request.width, request.height)
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(0, bottom, request.width, request.height)
        gl.clear(gl.COLOR_BUFFER_BIT)
        const { low, high } = spectralBands(tiles.sampleRate, tiles.lowBins, tiles.highBins)
        gl.uniform4f(uniform('frequency'), request.minHz, request.maxHz, request.scale === 'log' ? 1 : 0, 0)
        gl.uniform4f(uniform('bands'), low.first, low.binHz, high.first, high.binHz)
        gl.uniform2i(uniform('binCounts'), low.bins, high.bins)
        gl.uniform3f(uniform('viewportSize'), request.width, request.height, bottom)
        gl.uniform1f(uniform('boost'), Math.round(request.boost ?? 0))
        const channel = Math.min(Math.max(0, request.channel), Math.max(0, tiles.channels - 1))
        const span = request.endFrame - request.startFrame
        for (const draw of planSpectralDraws(tiles, request)) {
          const current = slotOf(draw.tile, channel)
          const previous = draw.previous ? slotOf(draw.previous, channel) : -1
          const next = draw.next ? slotOf(draw.next, channel) : -1
          if (current < 0) continue
          const hop = spectralHop(draw.level)
          // 以本块首列为原点的列坐标，避免长素材上的大帧号丢失 float 精度。
          gl.uniform2f(uniform('timing'), (request.startFrame - spectralOrigin(draw.level)) / hop - draw.tile.columnStart, span / request.width / hop)
          gl.uniform3i(uniform('slots'), previous, current, next)
          gl.uniform1f(uniform('lowWeight'), draw.lowWeight)
          gl.uniform3i(uniform('columns'), draw.tile.columnStart, draw.tile.columnCount, draw.next?.columnCount ?? 0)
          gl.scissor(draw.x0, bottom, draw.x1 - draw.x0, request.height)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }
        gl.disable(gl.SCISSOR_TEST)
        if (gl.getError() === gl.OUT_OF_MEMORY) throw new Error('频谱显存不足')
      },
      clear: () => gl.clear(gl.COLOR_BUFFER_BIT), dispose,
    }
  } catch (error) { dispose(); throw error }
}
