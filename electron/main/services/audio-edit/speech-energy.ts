import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import type { AudioEditSourceMetadata } from '../../../../src/core/audioEdit/types'
import { SpeechEnergyHistogram, SpeechEnergyValleys, speechEnergyOptionsSchema, type SpeechEnergyAnalysis, type SpeechEnergyOptions } from '../../../../src/core/audioEdit/speechEnergy'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { runAudioEditProcess } from './process'

const FRAME_MS = 10
const MAX_FRAMES = 2_160_000 // Six hours; about 35 MB of numeric band data at the upper bound.

/** Keep channels separate: downmixing opposite-phase stereo can manufacture silence. */
export function speechEnergyFilter(options: SpeechEnergyOptions): { filter: string; complex: boolean } {
  const stats = (name: string): string => `astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level${name === 'wide' ? '+Number_of_samples' : ''},ametadata@${name}=print${name === 'wide' ? '' : ':key=lavfi.astats.Overall.RMS_level'}`
  const measure = `aresample=16000,asetpts=N/SR/TB,asetnsamples=n=160:p=0,${stats('wide')},highpass=f=2500,${stats('high')}`
  if (!options.channels) return { filter: measure, complex: false }
  const inputs = options.channels.map((channel, index) => `[0:a:${channel.stream}]aresample=16000,pan=mono|c0=c${channel.channel}[ch${index}]`)
  const joined = options.channels.map((_, index) => `[ch${index}]`).join('')
  return { filter: `${inputs.join(';')};${joined}${options.channels.length > 1 ? `amerge=inputs=${options.channels.length},` : ''}${measure}[energy]`, complex: true }
}

/** Decode/filter in FFmpeg; the coordinator receives only two levels per 10 ms, never PCM. */
export async function decodeSpeechEnergy(source: AudioEditSourceMetadata, raw: SpeechEnergyOptions, signal: AbortSignal, progress: (value: number) => void): Promise<SpeechEnergyAnalysis> {
  const options = speechEnergyOptionsSchema.parse(raw)
  if (source.durationFrames / source.sampleRate * 100 > MAX_FRAMES) throw new Error('声音分析目前支持六小时以内的素材，请缩短素材后重试。')
  signal.throwIfAborted()
  const wide: number[] = []; const high: number[] = []
  const wideHistogram = new SpeechEnergyHistogram(); const highHistogram = new SpeechEnergyHistogram()
  let failure: Error | undefined
  let lastSamples = 0
  const filter = speechEnergyFilter(options)
  const decode = new AbortController()
  const cancel = (): void => decode.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    await runAudioEditProcess(await loadFfmpegPath(), ['-hide_banner', '-nostats', '-i', source.audioPath,
      ...(filter.complex ? ['-filter_complex', filter.filter, '-map', '[energy]'] : ['-map', source.ownership === 'external' ? `0:${source.audioStreamIndex ?? 0}` : '0:a:0', '-af', filter.filter]),
      '-vn', '-f', 'null', '-'], decode.signal, line => {
      if (failure) return
      const samples = /\[ametadata@wide\s+@[^\]]*\]\s+lavfi\.astats\.Overall\.Number_of_samples=(\d+)/i.exec(line)
      if (samples) { lastSamples = Number(samples[1]); return }
      const match = /\[ametadata@(wide|high)\s+@[^\]]*\]\s+lavfi\.astats\.Overall\.RMS_level=(-?inf|[-\d.e+]+)\s*$/i.exec(line)
      if (!match) return
      const values = match[1] === 'wide' ? wide : high
      const value = match[2].toLowerCase() === '-inf' ? -Infinity : Number(match[2])
      if (values.length >= MAX_FRAMES || !(value === -Infinity || Number.isFinite(value))) {
        failure = new Error('声音分析超出六小时上限或包含无效电平，请缩短素材后重试。')
        decode.abort(failure)
        return
      }
      values.push(value)
      const histogram = match[1] === 'wide' ? wideHistogram : highHistogram
      histogram.add(value)
      if (match[1] === 'wide' && values.length % 100 === 0) progress(Math.min(.9, values.length * FRAME_MS / (source.durationFrames / source.sampleRate * 1000) * .9))
    }, undefined, 120_000)
  } catch (error) { throw failure ?? error }
  finally { signal.removeEventListener('abort', cancel) }
  if (failure) throw failure
  signal.throwIfAborted()
  if (!wide.length || wide.length !== high.length || lastSamples < 1 || lastSamples > 160) throw new Error('未获得完整的全频与高频声音证据，请重新分析。')
  const thresholdDb = wideHistogram.threshold(22); const highThresholdDb = highHistogram.threshold(16, -110)
  const valleys = new SpeechEnergyValleys(thresholdDb, highThresholdDb)
  const durationMs = (wide.length - 1) * FRAME_MS + lastSamples / 16
  for (let index = 0; index < wide.length; index++) {
    // Bound coordinator latency; expensive per-sample filtering already runs in the subprocess.
    if (index % 4096 === 0) { await yieldToEventLoop(); signal.throwIfAborted() }
    valleys.append(index * FRAME_MS, Math.min(durationMs, (index + 1) * FRAME_MS), wide[index], high[index])
  }
  valleys.flush()
  const result: SpeechEnergyAnalysis = { resolutionMs: FRAME_MS, thresholdDb, highThresholdDb, pauses: valleys.pauses }
  progress(1)
  return result
}
