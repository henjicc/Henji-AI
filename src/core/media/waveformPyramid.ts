/**
 * 多级精度波形峰值（任务 2.3，重要记录 005）的数据格式与读取算法。
 *
 * 思路取自 BBC audiowaveform / waveform-data.js 的多分辨率峰值（每级“每桶采样数”固定、逐级按整数倍合并），
 * 扩展为“峰值 + 响度（RMS）”两层、16 位定点、单文件多级。生成在主进程 Worker（waveform-worker.ts，
 * 唯一的 PCM 聚合实现），本文件只放主进程与渲染层共用的纯计算：常量、二进制编解码、按区间聚合、取级。
 *
 * 注意：主进程经相对路径导入本文件，这里不得使用 `@/` 别名，也不得依赖 DOM 或 Node 专有 API。
 */

/** 文件格式版本；变更布局或算法时递增，旧缓存自动失效。 */
export const WAVEFORM_PYRAMID_FORMAT_VERSION = 1
/** 第 0 级每桶采样数：48kHz 约 375 桶/秒、44.1kHz 约 345 桶/秒。 */
export const WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET = 128
/** 相邻两级的倍数（128 → 1024 → 8192 → 65536 …）。 */
export const WAVEFORM_PYRAMID_LEVEL_FACTOR = 8
/** 顶级桶数不超过它时停止加级。 */
export const WAVEFORM_PYRAMID_TOP_BUCKETS = 512
/** 精细档原始采样回读一次最多的采样帧数（48kHz 约 5.5 秒）。 */
export const WAVEFORM_DETAIL_MAX_FRAMES = 1 << 18
/** 定点满量程。 */
export const WAVEFORM_PYRAMID_QUANT = 65535

const MAGIC = [0x48, 0x57, 0x50, 0x4b] // "HWPK"
const HEADER_BYTES = 64
const LEVEL_ENTRY_BYTES = 8
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export interface WaveformPyramidLevel {
  samplesPerBucket: number
  bucketCount: number
  /** 每声道一份，定点值；线性幅度 = 值 × amplitudeScale / 65535。 */
  peak: Uint16Array[]
  rms: Uint16Array[]
}

export interface WaveformPyramidData {
  sampleRate: number
  /** 第 0 个采样位于素材绝对时钟 0 秒（与剪辑源时间、导入时长同一时钟）。 */
  frameCount: number
  /** 容器起点（绝对时钟），整段显示从这里开始。 */
  startSeconds: number
  /** 绝对结束时刻（与导入时长同口径）。 */
  endSeconds: number
  amplitudeScale: number
  /** 全部声道的最大线性峰值，用于统一归一化。 */
  peakMax: number
  channelCount: number
  /** 声音流本身的声道数。 */
  nativeChannels: number
  /** 最后一个声道是否为各声道平均的单声道混合。 */
  mixChannel: boolean
  levels: WaveformPyramidLevel[]
}

/** ceil(timeUs * sampleRate / 1e6)，不累积浮点误差。 */
export function audioWaveformSampleIndex(timeUs: number, sampleRate: number): number {
  return Number((BigInt(timeUs) * BigInt(sampleRate) + 999_999n) / 1_000_000n)
}

/** 各级每桶采样数与桶数；第 0 级之后按倍数加级直到顶级桶数不超过上限。 */
export function waveformPyramidLevelPlan(frameCount: number, base = WAVEFORM_PYRAMID_BASE_SAMPLES_PER_BUCKET, factor = WAVEFORM_PYRAMID_LEVEL_FACTOR, top = WAVEFORM_PYRAMID_TOP_BUCKETS): Array<{ samplesPerBucket: number; bucketCount: number }> {
  const frames = Math.max(1, Math.floor(frameCount))
  const levels = [{ samplesPerBucket: base, bucketCount: Math.ceil(frames / base) }]
  while (levels.at(-1)!.bucketCount > top) {
    const samplesPerBucket = levels.at(-1)!.samplesPerBucket * factor
    levels.push({ samplesPerBucket, bucketCount: Math.ceil(frames / samplesPerBucket) })
  }
  return levels
}

export function encodeWaveformPyramid(data: WaveformPyramidData): Uint8Array {
  if (!LITTLE_ENDIAN) throw new Error('波形缓存仅支持小端平台。')
  const dataBytes = data.levels.reduce((sum, level) => sum + level.bucketCount * data.channelCount * 4, 0)
  const offset = HEADER_BYTES + data.levels.length * LEVEL_ENTRY_BYTES
  const bytes = new Uint8Array(offset + dataBytes)
  const view = new DataView(bytes.buffer)
  MAGIC.forEach((value, index) => { bytes[index] = value })
  view.setUint16(4, WAVEFORM_PYRAMID_FORMAT_VERSION, true)
  view.setUint16(6, HEADER_BYTES, true)
  view.setUint32(8, data.sampleRate, true)
  view.setUint16(12, data.channelCount, true)
  view.setUint16(14, data.levels.length, true)
  view.setFloat64(16, data.frameCount, true)
  view.setFloat64(24, data.startSeconds, true)
  view.setFloat64(32, data.endSeconds, true)
  view.setFloat32(40, data.amplitudeScale, true)
  view.setFloat32(44, data.peakMax, true)
  view.setUint16(48, data.nativeChannels, true)
  view.setUint16(50, data.mixChannel ? 1 : 0, true)
  let cursor = HEADER_BYTES
  for (const level of data.levels) {
    view.setUint32(cursor, level.samplesPerBucket, true)
    view.setUint32(cursor + 4, level.bucketCount, true)
    cursor += LEVEL_ENTRY_BYTES
  }
  for (const level of data.levels) {
    for (let channel = 0; channel < data.channelCount; channel++) {
      for (const values of [level.peak[channel], level.rms[channel]]) {
        if (values.length !== level.bucketCount) throw new Error('波形级长度不一致。')
        bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), cursor)
        cursor += values.byteLength
      }
    }
  }
  return bytes
}

/** 解码并校验；任何不一致都抛错（调用方按缓存未命中处理）。返回的数组是输入字节的只读视图。 */
export function decodeWaveformPyramid(input: Uint8Array): WaveformPyramidData {
  if (!LITTLE_ENDIAN) throw new Error('波形缓存仅支持小端平台。')
  // Uint16Array 视图要求 2 字节对齐。
  const bytes = input.byteOffset % 2 ? input.slice() : input
  if (bytes.byteLength < HEADER_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) throw new Error('不是波形缓存文件。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(4, true) !== WAVEFORM_PYRAMID_FORMAT_VERSION || view.getUint16(6, true) !== HEADER_BYTES) throw new Error('波形缓存版本不符。')
  const sampleRate = view.getUint32(8, true)
  const channelCount = view.getUint16(12, true)
  const levelCount = view.getUint16(14, true)
  const frameCount = view.getFloat64(16, true)
  const data: Omit<WaveformPyramidData, 'levels'> = {
    sampleRate, channelCount, frameCount,
    startSeconds: view.getFloat64(24, true), endSeconds: view.getFloat64(32, true),
    amplitudeScale: view.getFloat32(40, true), peakMax: view.getFloat32(44, true),
    nativeChannels: view.getUint16(48, true), mixChannel: (view.getUint16(50, true) & 1) === 1,
  }
  if (!sampleRate || sampleRate > 768_000 || !channelCount || channelCount > 65 || !levelCount || levelCount > 16 || !Number.isSafeInteger(frameCount) || frameCount < 1
    || !Number.isFinite(data.startSeconds) || !Number.isFinite(data.endSeconds) || !(data.amplitudeScale >= 1) || !(data.peakMax >= 0)) throw new Error('波形缓存头无效。')
  let cursor = HEADER_BYTES
  const table: Array<{ samplesPerBucket: number; bucketCount: number }> = []
  for (let index = 0; index < levelCount; index++) {
    if (cursor + LEVEL_ENTRY_BYTES > bytes.byteLength) throw new Error('波形缓存被截断。')
    const samplesPerBucket = view.getUint32(cursor, true); const bucketCount = view.getUint32(cursor + 4, true)
    if (!samplesPerBucket || bucketCount !== Math.ceil(frameCount / samplesPerBucket)) throw new Error('波形缓存级表无效。')
    table.push({ samplesPerBucket, bucketCount }); cursor += LEVEL_ENTRY_BYTES
  }
  const expected = cursor + table.reduce((sum, level) => sum + level.bucketCount * channelCount * 4, 0)
  if (expected !== bytes.byteLength) throw new Error('波形缓存长度不符。')
  const levels = table.map((level) => {
    const peak: Uint16Array[] = []; const rms: Uint16Array[] = []
    for (let channel = 0; channel < channelCount; channel++) {
      peak.push(new Uint16Array(bytes.buffer, bytes.byteOffset + cursor, level.bucketCount)); cursor += level.bucketCount * 2
      rms.push(new Uint16Array(bytes.buffer, bytes.byteOffset + cursor, level.bucketCount)); cursor += level.bucketCount * 2
    }
    return { ...level, peak, rms }
  })
  return { ...data, levels }
}

export function waveformPyramidByteSize(data: WaveformPyramidData): number {
  return HEADER_BYTES + data.levels.reduce((sum, level) => sum + LEVEL_ENTRY_BYTES + level.bucketCount * data.channelCount * 4, 0)
}

/** 每列至少一桶的最粗一级；列比第 0 级还细时返回第 0 级（调用方决定是否改用原始采样）。 */
export function selectWaveformLevel(levels: readonly WaveformPyramidLevel[], framesPerColumn: number): WaveformPyramidLevel {
  let selected = levels[0]
  for (const level of levels) if (level.samplesPerBucket <= framesPerColumn) selected = level
  return selected
}

/**
 * 把 [startFrame, endFrame) 等分成 count 列，每列取与之相交的各桶：峰值取最大、响度取均方根。
 * 输出线性幅度（未归一化）。列比桶细时取所在的那一桶，区间外为 0。
 */
export function aggregateWaveformLevel(level: WaveformPyramidLevel, channel: number, amplitudeScale: number, startFrame: number, endFrame: number, count: number, outPeak: Float32Array, outRms: Float32Array): void {
  const peaks = level.peak[channel]; const rmsValues = level.rms[channel]
  const scale = amplitudeScale / WAVEFORM_PYRAMID_QUANT
  const width = (endFrame - startFrame) / count
  const spb = level.samplesPerBucket
  for (let column = 0; column < count; column++) {
    const from = startFrame + column * width
    const to = from + width
    let first = Math.floor(from / spb)
    let last = Math.ceil(to / spb)
    if (last <= first) last = first + 1
    if (first < 0) first = 0
    if (last > level.bucketCount) last = level.bucketCount
    let peak = 0; let squares = 0
    for (let bucket = first; bucket < last; bucket++) {
      const value = peaks[bucket]
      if (value > peak) peak = value
      const rms = rmsValues[bucket]
      squares += rms * rms
    }
    const buckets = last - first
    outPeak[column] = buckets > 0 ? peak * scale : 0
    outRms[column] = buckets > 0 ? Math.sqrt(squares / buckets) * scale : 0
  }
}

/** 同一规则作用于原始采样（精细档）：每列峰值 = 绝对值最大，响度 = 均方根。 */
export function aggregateWaveformSamples(samples: Float32Array, firstFrame: number, startFrame: number, endFrame: number, count: number, outPeak: Float32Array, outRms: Float32Array): void {
  const width = (endFrame - startFrame) / count
  for (let column = 0; column < count; column++) {
    const from = startFrame + column * width - firstFrame
    let first = Math.floor(from)
    let last = Math.ceil(from + width)
    if (last <= first) last = first + 1
    if (first < 0) first = 0
    if (last > samples.length) last = samples.length
    let peak = 0; let squares = 0
    for (let index = first; index < last; index++) {
      const value = samples[index]
      const magnitude = value < 0 ? -value : value
      if (magnitude > peak) peak = magnitude
      squares += value * value
    }
    const used = last - first
    outPeak[column] = used > 0 ? peak : 0
    outRms[column] = used > 0 ? Math.sqrt(squares / used) : 0
  }
}

/** 选中声道的最大线性峰值：最粗一级的峰值即全段峰值。 */
export function waveformPyramidPeakMax(data: WaveformPyramidData, channels: readonly number[]): number {
  const top = data.levels.at(-1)!
  let peak = 0
  for (const channel of channels) for (const value of top.peak[channel]) if (value > peak) peak = value
  return peak * data.amplitudeScale / WAVEFORM_PYRAMID_QUANT
}
