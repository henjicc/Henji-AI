const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')

/**
 * 原生声音解码与混音（2.3）：真实 Electron 里由正式渲染 Worker 的 `mixAudio` 混出声音（Worker → 帧通道端口 →
 * preload → 主进程 → 原生服务声音会话 → libsoxr），与 FFmpeg 直接解出并用同一重采样器（soxr，精度 28 位）转到 48kHz 的
 * 参考 PCM 逐样本对照：
 * - 片段放在时间线 0.5s、源入点 0.7s+1/3µs、持续 2s，按 0.5 秒块混音（与节目播放同一块长），检验绝对采样边界、
 *   分数微秒入点、跨块与片段两端；
 * - 每个样本求 ±10ms 内的最佳时差与该时差下的相关系数（验收：≥0.98、时差 <10ms），并记录零时差的最大误差；
 * - 样本：ProRes MOV（PCM 24 位 48kHz 立体声）、MXF（DNxHR + 两条单声道 PCM，只取第一条）、AAC MP4（44.1kHz，
 *   原生 soxr 转 48kHz）、96kHz PCM WAV（纯声音，96→48kHz）；浏览器能解的文件另用强制浏览器后端混一次作对照；
 * - Worker 关闭后原生声音会话全部回收。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-native-audio')
const RATE = 48000
const FPS = 30
const CLIP = { startFrame: 15, durationFrames: 60, sourceInUs: 700_000, remainder: { numerator: 1, denominator: 3 } }
const MIX_SECONDS = 3
const BLOCK_SECONDS = 0.5
const MAX_LAG = Math.round(RATE * 0.01)
const SIGNAL = "aevalsrc='0.25*sin(2*PI*330*t)+0.15*sin(2*PI*(100+1500*t)*t)+0.1*(random(0)-0.5)|0.25*sin(2*PI*550*t)+0.12*sin(2*PI*(3000-800*t)*t)+0.1*(random(1)-0.5)'"

const SAMPLES = [
  { file: 'prores_pcm.mov', kind: 'video', browser: false, args: (out) => ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', `${SIGNAL}:s=48000:d=4`, '-c:v', 'prores_ks', '-profile:v', '1', '-c:a', 'pcm_s24le', '-shortest', out] },
  { file: 'dnxhr_pcm.mxf', kind: 'video', browser: false, args: (out) => ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', `${SIGNAL}:s=48000:d=4`, '-filter_complex', '[1:a]channelsplit=channel_layout=stereo[l][r]', '-map', '0:v', '-map', '[l]', '-map', '[r]', '-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s24le', '-shortest', out] },
  { file: 'h264_aac441.mp4', kind: 'video', browser: true, args: (out) => ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', `${SIGNAL}:s=44100:d=4`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', out] },
  { file: 'pcm96.wav', kind: 'audio', browser: true, args: (out) => ['-f', 'lavfi', '-i', `${SIGNAL}:s=96000:d=4`, '-c:a', 'pcm_s24le', out] },
]

function prepare(sample) {
  const file = path.join(ROOT, sample.file)
  if (!fs.existsSync(file)) execFileSync(ffmpegPath, ['-v', 'error', '-y', ...sample.args(file)], { windowsHide: true, timeout: 120000 })
  const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true }).toString())
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio')
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  // The reference: the first sound stream, decoded and resampled by FFmpeg with the same resampler (absolute timeline:
  // FFmpeg starts the output at the stream's first sample, which these files put at 0).
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-map', '0:a:0', '-af', `aresample=${RATE}:resampler=soxr:precision=28`, '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  const channels = audio.channels
  const frames = raw.length / 4 / channels
  const planes = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let index = 0; index < frames; index++) for (let channel = 0; channel < channels; channel++) planes[channel][index] = raw.readFloatLE((index * channels + channel) * 4)
  return { ...sample, path: file, reference: planes, audio, video, durationSeconds: Number(probe.format.duration), startSeconds: Number(audio.start_time ?? 0) }
}

/** Correlation of `actual` against `expected` shifted by `lag` samples, over the indices in `range`. */
function correlation(actual, expected, lag, range) {
  let ab = 0; let aa = 0; let bb = 0
  for (let index = range[0]; index < range[1]; index++) {
    const other = expected(index - lag)
    ab += actual[index] * other; aa += actual[index] * actual[index]; bb += other * other
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

function compare(mix, sample) {
  const clipStart = Math.ceil(CLIP.startFrame / FPS * RATE - 1e-7)
  const clipEnd = Math.ceil((CLIP.startFrame + CLIP.durationFrames) / FPS * RATE - 1e-7)
  const inPoint = (CLIP.sourceInUs + CLIP.remainder.numerator / CLIP.remainder.denominator) / 1e6
  const channels = []
  for (let channel = 0; channel < mix.length; channel++) {
    const plane = sample.reference[Math.min(channel, sample.reference.length - 1)]
    // Source sample for output sample s (nearest sample: the mix reads blocks at the sequence rate that way).
    const expected = (s) => {
      if (s < clipStart || s >= clipEnd) return 0
      const position = Math.floor((inPoint + (s - clipStart) / RATE + (clipStart / RATE - CLIP.startFrame / FPS)) * RATE + 0.5 + 1e-6)
      return position >= 0 && position < plane.length ? plane[position] : 0
    }
    // Inside the clip, away from its edges by more than the lag window.
    const range = [clipStart + MAX_LAG, clipEnd - MAX_LAG]
    let best = { lag: 0, value: -Infinity }
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag++) {
      const value = correlation(mix[channel], expected, lag, range)
      if (value > best.value) best = { lag, value }
    }
    let maxError = 0; let outside = 0
    for (let s = 0; s < mix[channel].length; s++) {
      if (s >= clipStart && s < clipEnd) maxError = Math.max(maxError, Math.abs(mix[channel][s] - expected(s)))
      else outside = Math.max(outside, Math.abs(mix[channel][s]))
    }
    channels.push({ channel, bestLagSamples: best.lag, bestLagMs: best.lag / RATE * 1000, correlationAtBest: best.value, correlationAtZero: correlation(mix[channel], expected, 0, range), maxErrorAtZero: maxError, maxOutsideClip: outside })
  }
  return channels
}

async function installHarness(page) {
  const assets = path.resolve('out/renderer/assets')
  const name = fs.readdirSync(assets).find((file) => /^videoEditWorker-[\w-]+\.js$/.test(file))
  assert.ok(name, '构建产物里找不到剪辑渲染 Worker')
  await page.evaluate(async (workerUrl) => {
    window.__henjiNativeAudio?.worker.terminate()
    const worker = new Worker(new URL(workerUrl, location.href), { type: 'module' })
    const pending = new Map()
    let next = 1
    worker.addEventListener('message', (event) => {
      const entry = pending.get(event.data?.id)
      if (!entry) return
      pending.delete(event.data.id)
      if (event.data.error) entry.reject(new Error(event.data.error)); else entry.resolve(event.data)
    })
    const native = window.henjiNative.videoFrames
    let route = null
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('帧通道端口未送达')), 5000)
      const onMessage = (event) => {
        if (event.data?.type !== 'henji:video-frames-port' || event.data.route !== route || !event.ports[0]) return
        window.removeEventListener('message', onMessage); clearTimeout(timer); resolve(event.ports[0])
      }
      window.addEventListener('message', onMessage)
      route = native.connect()
    })
    worker.postMessage({ kind: 'nativeFrames.attach', port }, [port])
    const request = (message) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }) })
    window.__henjiNativeAudio = {
      worker, route, request,
      async mix(document, decode, seconds, block) {
        await request({ kind: 'init', document, decode })
        const blocks = []; const timings = []; const sessions = []
        for (let start = 0; start < seconds - 1e-9; start += block) {
          const at = performance.now()
          const response = await request({ kind: 'audio', start, duration: Math.min(block, seconds - start) })
          timings.push(performance.now() - at)
          blocks.push(response.channels.map((channel) => Array.from(channel)))
          // Native sound sessions after each block: open while the block touches the clip, released once past it.
          sessions.push((await native.stats()).native?.audioSessions ?? null)
        }
        const channels = blocks[0].map((_, channel) => blocks.flatMap((entry) => entry[channel]))
        return { channels, timings, sessions }
      },
      async close() {
        await request({ kind: 'dispose' })
        worker.terminate(); native.disconnect(route)
      },
    }
  }, `./assets/${name}`)
}

function composition(sample, revision) {
  const url = `henji-media://local/${encodeURIComponent(sample.path)}`
  const video = sample.video
  return {
    url,
    document: {
      id: `native-audio-${sample.file}`, name: sample.file, revision,
      width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, fps: FPS, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: RATE, channels: 2,
      media: [{ id: 'm', name: sample.file, path: url, kind: sample.kind, width: video ? video.width : 0, height: video ? video.height : 0, durationSeconds: sample.durationSeconds, hasAudio: true, ...(video ? { frameRate: { numerator: FPS, denominator: 1 } } : {}) }],
      items: [{ id: 'i', name: sample.file, kind: sample.kind, mediaId: 'm' }],
      tracks: [{ id: 't', name: 'A1', index: 0, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
      clips: [{ id: 'c', itemId: 'i', name: sample.file, kind: 'audio', sourceComponent: 'audio', track: 0, start: CLIP.startFrame, duration: CLIP.durationFrames, sourceInUs: CLIP.sourceInUs, sourceRemainder: CLIP.remainder, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }],
      annotations: [],
    },
  }
}

async function nativeAudioSessions(page) {
  const stats = await page.evaluate(() => window.henjiNative.videoFrames.stats())
  return stats.native?.audioSessions ?? null
}

function createVideoEditNativeAudioScene() {
  return {
    id: 'video-edit-native-audio', surface: '剪辑', name: '剪辑-原生声音解码混音与 FFmpeg 参考 PCM 互相关', writesUserData: false,
    setup: async (page) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { clip: CLIP, rate: RATE, blockSeconds: BLOCK_SECONDS, samples: [] }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      try {
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        assert.equal(status.available, true, '本机原生解码服务应可用')
        await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), ROOT)
        let revision = 0
        for (const definition of SAMPLES) {
          const sample = prepare(definition)
          const record = { file: sample.file, codec: sample.audio.codec_name, sourceRate: Number(sample.audio.sample_rate), sourceChannels: sample.audio.channels, results: [] }
          evidence.samples.push(record); store()
          for (const forced of sample.browser ? ['native', 'browser'] : ['native']) {
            await installHarness(page)
            const { url, document } = composition(sample, ++revision)
            const decode = { nativeAvailable: true, forced, localPaths: { [url]: sample.path } }
            const mixed = await page.evaluate(({ document, decode, seconds, block }) => window.__henjiNativeAudio.mix(document, decode, seconds, block), { document, decode, seconds: MIX_SECONDS, block: BLOCK_SECONDS })
            const channels = compare(mixed.channels.map((channel) => Float32Array.from(channel)), sample)
            await page.evaluate(() => window.__henjiNativeAudio.close())
            const result = { backend: forced, samples: mixed.channels[0].length, mixMs: { mean: mixed.timings.reduce((sum, value) => sum + value, 0) / mixed.timings.length, max: Math.max(...mixed.timings) }, sessionsAfterBlocks: mixed.sessions, channels }
            record.results.push(result); store()
            assert.equal(mixed.channels.length, 2); assert.equal(mixed.channels[0].length, MIX_SECONDS * RATE)
            for (const channel of channels) {
              assert.ok(channel.correlationAtBest >= 0.98, `${sample.file}（${forced}）声道 ${channel.channel} 相关系数 ${channel.correlationAtBest}`)
              assert.ok(Math.abs(channel.bestLagMs) < 10, `${sample.file}（${forced}）声道 ${channel.channel} 时差 ${channel.bestLagMs}ms`)
              assert.ok(channel.maxOutsideClip === 0, `${sample.file}（${forced}）片段之外应为静音`)
            }
            if (forced === 'native') {
              // Blocks 1-4 (0.5-2.5s) touch the clip: its session is open; block 5 (2.5-3s) is past it: released.
              assert.ok(mixed.sessions.slice(1, 5).every((count) => count >= 1), `原生混音期间应有声音会话：${JSON.stringify(mixed.sessions)}`)
              assert.equal(mixed.sessions[5], 0, `片段离开混音范围后应释放声音会话：${JSON.stringify(mixed.sessions)}`)
              // Same resampler, same absolute grid: aligned to the sample.
              for (const channel of channels) assert.equal(channel.bestLagSamples, 0, `${sample.file} 原生混音应与参考逐样本对齐`)
            }
          }
          // Every sound session of the closed worker is released.
          let sessions = null
          for (let attempt = 0; attempt < 100 && sessions !== 0; attempt++) { sessions = await nativeAudioSessions(page); if (sessions !== 0) await page.waitForTimeout(50) }
          record.sessionsAfterClose = sessions; store()
          assert.equal(sessions, 0, `${sample.file} 关闭后仍有原生声音会话`)
        }
        evidence.completed = true; store()
      } catch (error) {
        evidence.error = String(error?.stack ?? error); store()
        throw error
      }
    },
  }
}

module.exports = { createVideoEditNativeAudioScene }
