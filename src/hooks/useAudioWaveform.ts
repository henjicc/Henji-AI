import { useEffect, useMemo, useState } from 'react'
import { nativeFetch, readFile } from '@/platform/desktopApi'

const SAFE_LOCAL_WAVEFORM_HOSTS = new Set(['localhost', '127.0.0.1', 'asset.localhost', 'tauri.localhost'])
// v5：新增主进程 ffmpeg 分桶路径，与渲染层 Web Audio 全量解码数值不完全一致，
// bump 版本号避免新旧算法结果在缓存里混用导致同一音频刷新前后波形跳变。
const WAVEFORM_ALGO_VERSION = '2026-07-01-v5'
const waveformMemoryCache = new Map<string, number[]>()

function isCrossOriginWaveformRestricted(source: string): boolean {
  if (!source || typeof window === 'undefined') {
    return false
  }
  try {
    const parsed = new URL(source, window.location.href)
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:' || parsed.protocol === 'file:') {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    if (SAFE_LOCAL_WAVEFORM_HOSTS.has(parsed.hostname.toLowerCase())) {
      return false
    }
    return parsed.origin !== window.location.origin
  } catch {
    return false
  }
}

function buildFallbackWaveform(seed: string, bars = 256): number[] {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 16777619) >>> 0
  }
  const result: number[] = []
  for (let index = 0; index < bars; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const noise = (state & 0xffff) / 0xffff
    const envelope = Math.sin((index / Math.max(1, bars - 1)) * Math.PI)
    const value = 0.12 + envelope * 0.46 + noise * 0.22
    result.push(Math.max(0.06, Math.min(1, value)))
  }
  return result
}

/**
 * 把每桶的原始能量值（rms*1.2 与 peak*0.65 取大值）转成最终展示曲线：百分位归一化 → 幂次
 * 变换 → 平滑 → 底部楼层限制。主进程分桶结果和渲染层 Web Audio 全量解码结果共用这一套曲线
 * 调整逻辑，避免两条路径的展示效果逐渐漂移。
 */
function postProcessWaveform(rawBars: number[], compact: boolean): number[] {
  const sorted = [...rawBars].sort((a, b) => a - b)
  const percentile = (ratio: number): number => {
    if (sorted.length === 0) return 0
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))
    return sorted[index]
  }
  const low = percentile(0.1)
  const high = percentile(0.98)
  const range = Math.max(1e-6, high - low)
  const norm = rawBars.map((v) => Math.max(0, Math.min(1, (v - low) / range)))
  const expanded = norm.map((v) => Math.pow(v, compact ? 0.72 : 0.78))
  return smoothWaveform(expanded, compact ? 1 : 2).map((v) => {
    const floor = compact ? 0.014 : 0.004
    return Math.max(floor, Math.min(1, v))
  })
}

function smoothWaveform(values: number[], radius = 2): number[] {
  if (values.length <= 2 || radius <= 0) {
    return values
  }
  const result: number[] = new Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    let sum = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset]
      if (typeof value === 'number') {
        sum += value
        count += 1
      }
    }
    result[index] = count > 0 ? sum / count : values[index]
  }
  return result
}

async function fetchAudioArrayBuffer(source: string, localFilePath?: string): Promise<ArrayBuffer> {
  if (localFilePath) {
    const bytes = await readFile(localFilePath)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  if (isCrossOriginWaveformRestricted(source)) {
    const response = await nativeFetch(source, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`waveform native fetch failed: ${response.status}`)
    }
    return response.arrayBuffer()
  }
  const response = await fetch(source, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`waveform fetch failed: ${response.status}`)
  }
  return response.arrayBuffer()
}

export interface UseAudioWaveformOptions {
  width: number
  compact?: boolean
  duration?: number
}

export interface UseAudioWaveformResult {
  waveform: number[] | null
  waveDuration: number | null
}

/** 拉取音频并解码为波形采样点，按来源+精度+算法版本缓存，解码失败时回退到确定性伪波形 */
export function useAudioWaveform(
  src: string,
  filePath: string | undefined,
  { width, compact = false, duration }: UseAudioWaveformOptions
): UseAudioWaveformResult {
  const [waveform, setWaveform] = useState<number[] | null>(null)
  const [waveDuration, setWaveDuration] = useState<number | null>(null)
  const targetBars = useMemo(
    () => Math.max(96, Math.min(320, Math.floor(width * (compact ? 0.72 : 0.62)))),
    [width, compact]
  )
  const cacheSourceKey = useMemo(() => filePath?.trim() || src, [filePath, src])
  const cacheKey = useMemo(
    () => `${cacheSourceKey}::${targetBars}::${compact ? 'compact' : 'default'}::${WAVEFORM_ALGO_VERSION}`,
    [cacheSourceKey, targetBars, compact]
  )

  useEffect(() => {
    if (!src) {
      setWaveform(null)
      setWaveDuration(null)
      return
    }
    let aborted = false
    const run = async () => {
      const cachedWaveform = waveformMemoryCache.get(cacheKey)
      if (cachedWaveform) {
        if (!aborted) {
          setWaveform(cachedWaveform)
          setWaveDuration((prev) => prev || duration || null)
        }
        return
      }
      if (!aborted) {
        setWaveDuration(null)
      }

      const nativeSource = filePath?.trim() || src
      const native = window.henjiNative
      if (native && nativeSource) {
        try {
          const result = await native.audio.extractSamples({ source: nativeSource, bucketCount: targetBars })
          const rmsList = result.rms as number[]
          const peakList = result.peak as number[]
          const arr = rmsList.map((rmsValue, index) => Math.max(rmsValue * 1.2, (peakList[index] ?? 0) * 0.65))
          const smooth = postProcessWaveform(arr, compact)
          if (!aborted) {
            waveformMemoryCache.set(cacheKey, smooth)
            setWaveform(smooth)
            setWaveDuration(result.durationSeconds || null)
          }
          return
        } catch {
          // 主进程处理失败（如无本地路径可解析、无音轨等），走下面的渲染层 Web Audio 后备
        }
      }

      try {
        const buf = await fetchAudioArrayBuffer(src, filePath)
        const Ctx = window.AudioContext ?? ((window as DynamicValue as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        if (!Ctx) {
          if (!aborted) {
            const fallback = buildFallbackWaveform(cacheKey)
            waveformMemoryCache.set(cacheKey, fallback)
            setWaveform(fallback)
          }
          return
        }
        const ctx = new Ctx()
        const audioBuf = await ctx.decodeAudioData(buf)
        const ch0 = audioBuf.getChannelData(0)
        const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null
        const bars = targetBars
        const step = Math.floor(ch0.length / bars) || 1
        const arr: number[] = []
        for (let i = 0; i < bars; i++) {
          let peak = 0
          let sumSquares = 0
          let count = 0
          const start = i * step
          const end = Math.min(ch0.length, start + step)
          for (let j = start; j < end; j++) {
            const v = ch1
              ? (Math.abs(ch0[j]) + Math.abs(ch1[j])) * 0.5
              : Math.abs(ch0[j])
            sumSquares += v * v
            count += 1
            if (v > peak) peak = v
          }
          const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0
          arr.push(Math.max(rms * 1.2, peak * 0.65))
        }
        const smooth = postProcessWaveform(arr, compact)
        if (!aborted) {
          waveformMemoryCache.set(cacheKey, smooth)
          setWaveform(smooth)
          setWaveDuration(audioBuf.duration || null)
        }
      } catch {
        if (!aborted) {
          const fallback = buildFallbackWaveform(cacheKey)
          waveformMemoryCache.set(cacheKey, fallback)
          setWaveform(fallback)
        }
      }
    }
    run()
    return () => { aborted = true }
  }, [cacheKey, src, filePath, targetBars, compact, duration])

  return { waveform, waveDuration }
}
