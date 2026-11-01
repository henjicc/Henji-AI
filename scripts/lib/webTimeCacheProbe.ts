import { app, BrowserWindow, ipcMain, sharedTexture, webContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { GpuFrameCapture } from '../../electron/main/services/web-replay/player/gpuCapture'
import { CAPTURE_TOKEN_COLORS } from '../../packages/web-replay-probe/src/replay/types'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import { VideoFrameBridge, type VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { FrameEncoder } from '../../electron/main/services/web-replay/player/encoder'
import { WEB_CACHE_COLOR_ARGS, webCacheEncodeArgs } from '../../electron/main/services/video/hwaccel'
import { validateWebTimeSegment } from '../../electron/main/services/web-source/segmentValidation'
import { probeWebCacheHardware, WebCacheCapabilityGate } from '../../electron/main/services/web-source/capability'
import { webTimeAtFrame, webTimeGrid, webTimeSegment } from '../../src/core/videoEdit/webTimeCache'
import { WebSourcePage } from '../../electron/main/services/web-source/page'
import { WebSourceBatch } from '../../electron/main/services/web-source/batch'
import { publishWebTimeSegment, readWebTimeSegment } from '../../electron/main/services/web-source/publication'
import { WebCacheLocks } from '../../electron/main/services/web-source/locks'
import { WebCacheSubmissions } from '../../electron/main/services/web-source/submissions'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import { appendLogEvents } from '../../electron/main/services/logging/push'
import { queryLogEvents } from '../../electron/main/services/logging/query'
import { environmentProbe } from './webTimeCacheEnvironmentProbe'
import { activityProbe } from './webTimeCacheActivityProbe'
import { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import { schedulerProbe } from './webTimeCacheSchedulerProbe'
import { sharedDecodeProbe } from './webTimeCacheSharedDecodeProbe'
import { acceptanceProbe } from './webTimeCacheAcceptanceProbe'
import { memoryProbe } from './webTimeCacheMemoryProbe'

const output = process.env.HENJI_WEB_CACHE_PROBE_OUTPUT!
const encoders = new Set<ReturnType<typeof spawn>>()
const frameEncoders = new Set<FrameEncoder>()
app.on('before-quit', () => { for (const encoder of encoders) encoder.kill(); for (const encoder of frameEncoders) void encoder.abort() })
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

/* 夹具色值是彩字失真测量输入，不是产品界面的主题颜色。 */
/* eslint-disable no-restricted-syntax */
function fixture(width: number, height: number): string {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
<canvas width="${width}" height="${height}"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
window.paint=(frame,token)=>{
const w=canvas.width,h=canvas.height;
ctx.fillStyle=frame%2?'#181a21':'#20232a';ctx.fillRect(0,0,w,h);
const colors=['#ff3030','#00dcff','#ff00df','#40ff40','#ffffff'];
for(let y=40;y<h;y+=58){
ctx.font='18px "Microsoft YaHei"';ctx.fillStyle=colors[Math.floor(y/58)%colors.length];
for(let x=20;x<w;x+=480)ctx.fillText('网页彩字 Cache 0123456789 细线',x,y);
ctx.fillRect(20,y+8,w-40,1);
}
/* eslint-enable no-restricted-syntax */
const gradient=ctx.createLinearGradient(0,0,w,0);gradient.addColorStop(0,'black');gradient.addColorStop(1,'white');
ctx.fillStyle=gradient;ctx.fillRect(0,h-60,w,60);
if(token){ctx.fillStyle='rgb('+token.join(',')+')';ctx.fillRect(0,0,8,8);}
};window.paint(0,null);
</script>`
}

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

async function throughput(width: number, height: number, ffmpeg: string, qp = 0): Promise<unknown> {
  const capture = new GpuFrameCapture(9, 'yuv444p')
  const name = `${width}-qp${qp}`
  const scale = width / 1920
  const source = new BrowserWindow({ show: false, frame: false, useContentSize: true, width: 1920, height: 1080,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      offscreen: { useSharedTexture: true, deviceScaleFactor: scale } } })
  let encoder: ReturnType<typeof spawn> | undefined
  let finished: Promise<number | null> | undefined
  let frameEncoder: FrameEncoder | undefined
  try {
    await capture.open()
    capture.attach(source.webContents)
    source.webContents.setFrameRate(240)
    await source.loadURL('about:blank')
    source.webContents.debugger.attach('1.3')
    await source.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: scale, mobile: false,
      viewport: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
    })
    await source.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixture(width, height))}`)
    await source.webContents.executeJavaScript('document.fonts.ready')
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'cuda', '-f', 'rawvideo', '-pixel_format', 'yuv444p',
      '-video_size', `${width}x${height}`, '-framerate', '60',
      // rawvideo 没有容器色彩信息，输入端也要声明，否则 FFmpeg 会按未知矩阵做二次转换。
      ...WEB_CACHE_COLOR_ARGS, '-i', 'pipe:0', ...webCacheEncodeArgs(60, qp),
      ...WEB_CACHE_COLOR_ARGS, path.join(output, `${name}.mp4`)]
    let errorText = ''
    if (qp === 0) {
      frameEncoder = new FrameEncoder(width, height, { numerator: 60, denominator: 1 }, path.join(output, `${name}.mp4`), 'yuv444p', ffmpeg)
      frameEncoders.add(frameEncoder)
      await frameEncoder.start(width, height)
    } else {
      encoder = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
      encoders.add(encoder)
      encoder.once('close', () => { encoders.delete(encoder!) })
      encoder.stderr!.on('data', data => { errorText += String(data) })
      encoder.stdin!.on('error', () => undefined)
      finished = new Promise((resolve, reject) => { encoder!.once('error', reject); encoder!.once('close', resolve) })
      finished.catch(() => undefined)
    }
    const seekMs: number[] = [], captureMs: number[] = [], pipeMs: number[] = [], guardMs: number[] = [], pixelsMs: number[] = []
    const count = 120, warmup = 6
    let started = 0
    for (let n = 0; n < count + warmup; n++) {
      if (n === warmup) started = performance.now()
      capture.discard()
      const token = n % CAPTURE_TOKEN_COLORS.length
      const before = performance.now()
      await source.webContents.executeJavaScript(`window.paint(${n},${JSON.stringify(CAPTURE_TOKEN_COLORS[token])})`)
      const painted = performance.now()
      const frame = await capture.take(token, 5000)
      if (!frame || frame.width !== width || frame.height !== height) throw new Error(`捕获尺寸或帧缺失：${frame?.width}x${frame?.height}`)
      const bytes = frame.bitmap()
      if (n === 0) {
        await fs.writeFile(path.join(output, `${name}.yuv`), bytes)
        // 去掉探针票据后读同一画布的无损像素，真值不经过 YUV 转换。
        const png = await source.webContents.executeJavaScript('window.paint(0,null);document.querySelector("canvas").toDataURL("image/png").split(",")[1]') as string
        await fs.writeFile(path.join(output, `${name}-truth.png`), Buffer.from(png, 'base64'))
      }
      const read = performance.now()
      if (frameEncoder) await frameEncoder.write(bytes, n)
      else await new Promise<void>((resolve, reject) => encoder!.stdin!.write(bytes, error => error ? reject(error) : resolve()))
      const sent = performance.now()
      if (n >= warmup) {
        seekMs.push(painted - before); captureMs.push(read - painted); pipeMs.push(sent - read)
        if (capture.lastTimings) { guardMs.push(capture.lastTimings.guardMs); pixelsMs.push(capture.lastTimings.pixelsMs) }
      }
    }
    const sentAt = performance.now()
    if (frameEncoder) await frameEncoder.finish(count + warmup - 1)
    else { encoder!.stdin!.end(); if (await finished !== 0) throw new Error(errorText) }
    const complete = performance.now()
    const size = (await fs.stat(path.join(output, `${name}.mp4`))).size
    const contract = await validateWebTimeSegment(path.join(output, `${name}.mp4`), {
      grid: webTimeGrid({ numerator: 60, denominator: 1 }, { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }),
      frameCount: count + warmup, width, height,
    }, AbortSignal.timeout(30_000), { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') })
    const describe = (values: number[]): unknown => ({ p50: percentile(values, .5), p95: percentile(values, .95), mean: values.reduce((a, b) => a + b, 0) / values.length })
    return { name, width, height, qp, frames: count, warmup, size, mbps: size * 8 / ((count + warmup) / 60) / 1e6,
      mbPerMinute: size / ((count + warmup) / 60) * 60 / 1e6, fpsIncludingDrain: count * 1000 / (complete - started),
      totalMs: complete - started, drainMs: complete - sentAt, seekMs: describe(seekMs),
      captureAndReadbackMs: describe(captureMs), guardMs: describe(guardMs), gpuGatherReadbackMs: describe(pixelsMs), pipeMs: describe(pipeMs), stats: capture.stats(),
      format: 'GPU yuv444p BT.709 limited → HEVC444; compositor fixture, not html-in-canvas',
      encoder: frameEncoder ? 'FrameEncoder' : 'qp-probe', contract, args: frameEncoder ? undefined : args }
  } finally {
    if (frameEncoder) { await frameEncoder.abort(); frameEncoders.delete(frameEncoder) }
    if (encoder && encoder.exitCode === null) { encoder.kill(); await finished?.catch(() => undefined) }
    source.destroy()
    await capture.dispose()
  }
}

async function truth(): Promise<unknown> {
  const source = new BrowserWindow({ show: false, frame: false, useContentSize: true, width: 1920, height: 1080,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      offscreen: true } })
  try {
    await source.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixture(1920, 1080))}`)
    await source.webContents.executeJavaScript('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
    const image = await source.webContents.capturePage()
    await fs.writeFile(path.join(output, 'truth.png'), image.toPNG())
    return { size: image.getSize(), versions: process.versions, argv: process.argv, gpuStatus: app.getGPUFeatureStatus(), gpu: await app.getGPUInfo('basic') }
  } finally { source.destroy() }
}

/** 奇数尺寸、非零相位与分数帧率走正式编码和校验入口，局部 PTS 每段从零开始。 */
async function segments(ffmpeg: string, tailFrames = 3): Promise<unknown> {
  const results: unknown[] = []
  const width = 257, height = 259, plane = width * height
  for (const rate of [{ numerator: 60, denominator: 1 }, { numerator: 30000, denominator: 1001 }]) {
    const grid = webTimeGrid(rate, { sourceInUs: 1234567, sourceRemainder: { numerator: 1, denominator: 3 } })
    const segmentLength = Math.max(1, Math.round(2 * rate.numerator / rate.denominator))
    for (const index of [0, 1]) {
      const segment = webTimeSegment(grid, index, webTimeAtFrame(grid, segmentLength + tailFrames))!
      const name = `segment-${rate.numerator}-${index}`
      const file = path.join(output, `${name}.tmp`)
      const encoder = new FrameEncoder(width, height, rate, file, 'yuv444p', ffmpeg)
      frameEncoders.add(encoder)
      const expected = await fs.open(path.join(output, `${name}.yuv`), 'w')
      try {
        await encoder.start(width, height)
        for (let frame = 0; frame < segment.frameCount; frame++) {
          const bytes = Buffer.alloc(plane * 3)
          for (let n = 0; n < plane; n++) {
            bytes[n] = 16 + (n + frame + segment.firstFrame) % 220
            bytes[plane + n] = 16 + (n + frame * 3) % 225
            bytes[plane * 2 + n] = 16 + (n + frame * 7) % 225
          }
          await encoder.write(bytes, frame)
          await expected.writeFile(bytes)
        }
        await encoder.finish(segment.frameCount - 1)
        const contract = { grid, frameCount: segment.frameCount, width: encoder.width, height: encoder.height }
        const verified = await validateWebTimeSegment(file, contract, AbortSignal.timeout(30_000), { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') })
        let rejectedMismatch = false
        try { await validateWebTimeSegment(file, { ...contract, frameCount: segment.frameCount + 1 }, AbortSignal.timeout(30_000), { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') }) } catch { rejectedMismatch = true }
        if (!rejectedMismatch) throw new Error('错误帧数契约未被拒绝')
        results.push({ name, file, grid, segment, validRect: [0, 0, width, height], codedSize: [encoder.width, encoder.height], verified, rejectedMismatch })
      } finally { await expected.close(); await encoder.abort(); frameEncoders.delete(encoder) }
    }
  }
  return results
}

async function nativeDecode(executable: string, file: string): Promise<unknown> {
  interface DecodedFrame { ticket: string; width: number; height: number; timestamp: number; error?: string; png?: Uint8Array }
  const logs: unknown[][] = []
  const record = (...args: unknown[]): void => { logs.push(args) }
  const service = new VideoDecoderService({ resolveExecutable: () => executable,
    logger: { debug: record, info: record, warn: record, error: record }, heartbeatIntervalMs: 0 })
  const bridge = new VideoFrameBridge({ service, sharedTexture, logger: { debug: record, info: record, warn: record, error: record } })
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(output, 'preload', 'decode.cjs'), backgroundThrottling: false } })
  const target: VideoFrameTarget = { id: window.webContents.id, isDestroyed: () => window.isDestroyed(),
    get mainFrame() { return window.webContents.mainFrame }, send: (channel, payload) => window.webContents.send(channel, payload),
    onGone: listener => { const gone = (): void => listener('destroyed'); window.once('closed', gone); return () => { window.off('closed', gone) } } }
  const frames: unknown[] = []
  const received = new Map<string, (value: DecodedFrame) => void>()
  const listener = (event: Electron.IpcMainEvent, value: DecodedFrame): void => {
    if (event.sender.id === target.id) received.get(value.ticket)?.(value)
  }
  ipcMain.on('web-cache-probe:decoded', listener)
  try {
    await window.loadURL('data:text/html,<title>Native cache decode probe</title>')
    const hello = await service.ensureStarted()
    const opened = await bridge.openDecoder(target, { route: 'cache-probe', path: file, purpose: 'seek', hardware: 'auto', format: 'rgbaf16', poolSize: 2 })
    if (!opened.decoder.hardware || opened.decoder.path !== 'cuda_planar') throw new Error(`未走444硬解消费：${JSON.stringify(opened.decoder)}`)
    for (const [index, time] of [0, ...Array.from({ length: 59 }, (_, i) => (i + 1) / 60), 1.5, 0.2, 1, 0].entries()) {
      const ticket = String(index)
      let timer: ReturnType<typeof setTimeout> | undefined
      const delivered = new Promise<DecodedFrame>((resolve, reject) => {
        received.set(ticket, resolve)
        timer = setTimeout(() => reject(new Error(`共享纹理取帧超时 ${ticket}`)), 15_000)
      })
      const started = performance.now()
      try {
        const [result, frame] = await Promise.all([bridge.frameAt(target.id, { streamId: opened.streamId, time, ticket }), delivered])
        if (frame.error) throw new Error(frame.error)
        if (!result.found || frame.width !== opened.visibleRect.width || frame.height !== opened.visibleRect.height) throw new Error('共享纹理帧尺寸或命中异常')
        if (frame.png) await fs.writeFile(path.join(output, `${path.basename(file, '.mp4')}-native${ticket === '0' ? '' : `-${ticket}`}.png`), frame.png)
        frames.push({ time, result, received: { width: frame.width, height: frame.height, timestamp: frame.timestamp }, endToEndMs: performance.now() - started })
      } finally { clearTimeout(timer); received.delete(ticket) }
    }
    const stats = await bridge.stats()
    await bridge.closeStream(opened.streamId)
    return { hello, opened, frames, stats, afterClose: await service.stats(), environment: { versions: process.versions, gpu: await app.getGPUInfo('basic') }, logs }
  } catch (error) {
    return { error: String(error), frames, logs }
  } finally { ipcMain.off('web-cache-probe:decoded', listener); await bridge.dispose(); await service.shutdown(); window.destroy() }
}

async function capability(ffmpeg: string): Promise<unknown> {
  const logs: unknown[][] = []
  const record = (...args: unknown[]): void => { logs.push(args) }
  const logger = { debug: record, info: record, warn: record, error: record }
  const service = new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger })
  const businessBridge = new VideoFrameBridge({ service, sharedTexture, logger })
  try {
    const gate = new WebCacheCapabilityGate(() => probeWebCacheHardware({ directory: path.join(output, 'capability'), service, logger,
      binaries: { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') } }), logger)
    const started = performance.now()
    const result = await gate.check()
    const afterClose = await service.stats()
    return { result, elapsedMs: performance.now() - started, afterClose, clean: afterClose.streams.length === 0, logs, versions: process.versions, gpu: await app.getGPUInfo('basic') }
  } finally { await businessBridge.dispose(); await service.shutdown() }
}

async function reliableSnapshots(): Promise<unknown> {
  const folder = path.join(output, 'snapshot-site')
  await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, 'index.html'), `<!doctype html><style>html,body{margin:0}#stage{width:100vw;height:100vh;background:rgb(0,0,0)}#corner{width:8px;height:4px;background:blue}</style><div id="stage" data-henji-stage><div id="corner"></div></div><script>
    window.henjiWeb={ready:Promise.resolve(),duration:10,seek(t){const v=Math.round(t*60)%2?255:0;document.getElementById('stage').style.background='rgb('+v+','+v+','+v+')';document.getElementById('corner').style.background=v?'red':'blue'}}
  </script>`)
  const results: unknown[] = []
  for (const [width, height, count] of [[257, 259, 24], [2560, 1440, 12], [3840, 2160, 12]]) {
    const reader = new GpuFrameCapture(0, 'yuv444p')
    let page: WebSourcePage | undefined
    const measurements: unknown[] = []
    try {
      await reader.open()
      const contents = reader.targetContents
      const target: VideoFrameTarget = { id: contents.id, mainFrame: contents.mainFrame, isDestroyed: () => contents.isDestroyed(), send: () => undefined, onGone: () => () => undefined }
      page = new WebSourcePage(`snapshot-${width}`, target, 'probe', { root: folder }, { width, height, region: [0, 0, width, height], scale: 1 }, 'fixture', () => undefined, () => undefined, new WebCacheSubmissions(createMainLogger('main.web_source')))
      await page.open()
      if (page.capturePath.captureMode !== 'html-in-canvas') throw new Error(JSON.stringify(page.capturePath))
      const identities = new Set<string>()
      let last: Awaited<ReturnType<WebSourcePage['captureReliable']>> | undefined
      for (let n = 0; n < count; n++) {
        const started = performance.now()
        last = await page.captureReliable(n / 60, `frame-${n}`, reader)
        const pixels = last.frame.bitmap(), expected = n % 2 ? 235 : 16
        if (last.frame.width !== width || last.frame.height !== height || pixels.length !== width * height * 3) throw new Error('守护区裁切尺寸错误')
        const corner = n % 2 ? [63, 102, 240] : [32, 240, 118]
        for (let i = 0; i < width * height; i++) for (let plane = 0; plane < 3; plane++) {
          const value = i % width < 8 && Math.floor(i / width) < 4 ? corner[plane] : plane === 0 ? expected : 128
          if (Math.abs(pixels[plane * width * height + i] - value) > 1) throw new Error(`画面/恢复像素错误 ${n},${plane} at ${i}: ${pixels[plane * width * height + i]} != ${value}`)
        }
        identities.add(last.identity)
        measurements.push({ n, ms: performance.now() - started, ...reader.lastTimings })
      }
      if (identities.size !== count) throw new Error('快照身份重复')
      if (!await last!.validate()) throw new Error('有效快照未通过发布代次检查')
      if (width === 257) {
        let rejected = false
        try {
          await page.captureReliable(count / 60, 'wrong-identity', { readSnapshot: (texture, guard) => reader.readSnapshot(texture, { ...guard, identity: 'f'.repeat(32) }) })
        } catch { rejected = true }
        if (!rejected || reader.lastTimings?.pixelsMs !== 0 || last!.isCurrent()) throw new Error('错帧被接受或未在像素读回前拒绝')
      } else {
        const source = webContents.getAllWebContents().find(contents => contents.isOffscreen())!
        await source.executeJavaScriptInIsolatedWorld(1001, [{ code: '(async () => { const state = window.__henjiWebSourceSnapshot; state.device.destroy(); await state.device.lost })()' }])
        if (await last!.validate()) throw new Error('设备丢失之后仍允许发布')
      }
      page.close()
      if (last?.isCurrent()) throw new Error('页面关闭后仍允许发布')
      results.push({ width, height, count, identities: identities.size, closedInvalidated: true, rejected: width === 257 ? 'wrong-identity-before-pixel-readback' : 'device-lost-before-publication', measurements })
    } finally { page?.close(); await reader.dispose() }
  }
  return { results, versions: process.versions, gpu: await app.getGPUInfo('basic') }
}

async function publication(ffmpeg: string, preempt = false): Promise<unknown> {
  const site = path.join(output, 'publication-site'), cacheRoot = path.join(output, 'cache')
  await fs.mkdir(site)
  const html = '<!doctype html><style>html,body{margin:0}div{width:100vw;height:100vh;background:red}</style><div data-henji-stage></div><script>window.henjiWeb={ready:Promise.resolve(),duration:.05,seek(t){document.querySelector("div").style.background=Math.round(t*60)%2?"blue":"red"}}</script>'
  await fs.writeFile(path.join(site, 'index.html'), html)
  const logger = createMainLogger('main.web_source')
  const service = new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger })
  const binaries = { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') }
  const gate = new WebCacheCapabilityGate(control => probeWebCacheHardware({ directory: path.join(output, 'hardware'), service, logger, binaries, control }), logger)
  const activity = new WebCacheActivity(service, logger)
  const submissions = new WebCacheSubmissions(logger, activity)
  let ready: Awaited<ReturnType<typeof publishWebTimeSegment>> | undefined
  const failures: string[] = []
  const preemptions: unknown[] = []
  try {
    for (const mode of ['valid', 'source-change'] as const) {
      const batch = await WebSourceBatch.begin(site)
      const reader = new GpuFrameCapture(0, 'yuv444p')
      let page: WebSourcePage | undefined
      const variant = { view: { width: 257, height: 259, region: [0, 0, 257, 259] as [number, number, number, number], scale: 1 }, deviceScaleFactor: 1,
        grid: webTimeGrid({ numerator: 60, denominator: 1 }, { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }), environmentSignature: `isolated-local-fixture-${mode}`, chromium: process.versions.chrome }
      const frames = (signal: AbortSignal): AsyncIterable<Awaited<ReturnType<WebSourcePage['captureReliable']>>> => (async function* () {
        await submissions.run(() => reader.open(), signal)
        const contents = reader.targetContents
        const target: VideoFrameTarget = { id: contents.id, mainFrame: contents.mainFrame, isDestroyed: () => contents.isDestroyed(), send: () => undefined, onGone: () => () => undefined }
        page = new WebSourcePage(`publish-${mode}`, target, 'probe', { root: site }, variant.view, batch.source.contentHash, () => undefined, () => undefined, submissions)
        await page.open(signal)
        for (let n = 0; n < 3; n++) {
          const frame = await page.captureReliable(n / 60, String(n), reader, ['div'], signal)
          if (mode === 'valid') await fs.appendFile(path.join(output, 'published-truth.yuv'), frame.frame.bitmap())
          if (mode === 'source-change' && n === 2) await fs.writeFile(path.join(site, 'index.html'), html + ' ')
          let paused: Promise<void> | undefined
          if (preempt && mode === 'valid' && n === 0) {
            const started = performance.now(), hold = submissions.hold('isolated-foreground'), submitted = submissions.state.submitted
            paused = (async () => {
              try {
                await hold.drained
                const drainMs = performance.now() - started
                await new Promise(resolve => setTimeout(resolve, 300))
                const delta = submissions.state.submitted - submitted
                const names = await fs.readdir(cacheRoot)
                if (delta !== 0 || names.length !== 1 || !names[0].includes('.tmp-') || !frame.isCurrent()) throw new Error('抢占期间继续提交或丢失已录制会话')
                preemptions.push({ drainMs, pausedMs: performance.now() - started, submittedWhilePaused: delta, retainedTemporaryFamily: true, frameStillCurrent: true })
              } finally { hold.resume() }
            })()
            void paused.catch(() => undefined)
          }
          yield frame
          await paused
        }
      })()
      try {
        const result = await publishWebTimeSegment({ cacheRoot, batch, variant, segment: { index: 0, firstFrame: 0, frameCount: 3 }, width: 257, height: 259,
          capability: gate, submissions, environmentCurrent: async () => true, frames, logger, binaries,
          withSegmentLock: (key, work, signal) => new WebCacheLocks(service).withSegmentLock(key, work, signal) })
        if (mode !== 'valid') throw new Error('来源变化仍发布')
        ready = result
        if (!await readWebTimeSegment(cacheRoot, result.manifest.variantKey, 0)) throw new Error('发布后读不到完整段族')
      } catch (error) {
        if (mode === 'valid') throw error
        failures.push(String(error))
      } finally { page?.close(); await reader.dispose(); batch.close() }
    }
    const names = await fs.readdir(cacheRoot)
    if (names.length !== 1 || names.some(name => name.includes('.tmp-')) || !failures[0]?.includes('失效')) throw new Error('失败段未正确清理')
    // 统一写队列的屏障事件之后，正式查询必须看得到业务发布和失败。
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.completed', message: '隔离发布专项完成', source: 'backend' }])
    const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source' })
    if (!logs.events.some(event => event.event === 'web_source.record.completed') || !logs.events.some(event => event.event === 'web_source.record.failed')) throw new Error('正式业务日志未读回')
    if (preempt && (!logs.events.some(event => event.event === 'web_source.record.preempted') || !logs.events.some(event => event.event === 'web_source.record.resumed'))) throw new Error('抢占恢复日志未读回')
    return { ready, failures, preemptions, logs, afterClose: await service.stats(), versions: process.versions }
  } finally { await activity.dispose(); await service.shutdown() }
}

async function locks(ffmpeg: string): Promise<unknown> {
  const logger = createMainLogger('main.web_source'), executable = path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe')
  const first = new VideoDecoderService({ resolveExecutable: () => executable, logger, restart: { maxRestarts: 0 } })
  const second = new VideoDecoderService({ resolveExecutable: () => executable, logger, restart: { maxRestarts: 0 } })
  const a = new WebCacheLocks(first), b = new WebCacheLocks(second)
  const root = path.join(output, 'lock-families'), destination = path.join(root, 'ready')
  await fs.mkdir(root)
  const temporary = async (name: string): Promise<string> => {
    const directory = await fs.mkdtemp(path.join(root, 'segment.tmp-'))
    await fs.writeFile(path.join(directory, 'identity'), name)
    return directory
  }
  let entered = false, peerEntered = false
  let unblock!: () => void
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  const identity = `${root}:same-segment`
  try {
    await first.ensureStarted(); await second.ensureStarted()
    const pids = [first.pid!, second.pid!]
    const oldWork = a.withSegmentLock(identity, async lease => {
      entered = true
      await blocked
      await lease.commit(await temporary('stale'), destination)
    }).then(() => { throw new Error('失主仍能提交') }, error => String(error))
    while (!entered) await new Promise(resolve => setTimeout(resolve, 5))
    const peer = b.withSegmentLock(identity, async lease => {
      peerEntered = true
      await lease.commit(await temporary('peer'), destination)
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    if (peerEntered) throw new Error('两个进程同时持有同一段写锁')
    const started = performance.now()
    // 只结束本专项创建的原生实例，模拟锁持有者异常退出。
    process.kill(pids[0])
    await peer
    unblock()
    const failure = await oldWork
    if (!/PROCESS_EXITED|SESSION_GONE|进程已退出/.test(failure)) throw new Error(`旧持有者未按租约失效拒绝：${failure}`)
    if (await fs.readFile(path.join(destination, 'identity'), 'utf8') !== 'peer') throw new Error(`旧持有者覆盖新实例结果：${failure}`)
    await b.withSegmentLock(identity, async lease => {
      const orphan = path.join(root, 'ready.tmp-orphan'), other = path.join(root, 'other.tmp-active')
      await fs.mkdir(orphan); await fs.mkdir(other)
      await lease.prepare(destination)
      if (await fs.stat(orphan).catch(() => null) || !await fs.stat(other).catch(() => null)) throw new Error('失主清理范围错误')
      await lease.commit(await temporary('rollback'), destination)
      await lease.rollback()
    })
    if (await fs.stat(destination).catch(() => null)) throw new Error('持锁回滚未删除本次发布段')
    return { pids, contentionMs: 100, recoveryMs: performance.now() - started, failure, peerPreserved: true, rollback: true, orphanCleanup: true }
  } finally { unblock(); await first.shutdown(); await second.shutdown() }
}

Object.assign(globalThis, { webTimeCacheProbe: { throughput, truth, nativeDecode, segments, capability, reliableSnapshots, publication, locks, memory: (ffmpeg: string) => memoryProbe(output, ffmpeg), activity: activityProbe, scheduler: (ffmpeg: string, stateful: boolean, readCache?: boolean) => schedulerProbe(output, ffmpeg, stateful, readCache), environment: () => environmentProbe(output), sharedDecode: sharedDecodeProbe, acceptance: (ffmpeg: string, width: number, height: number, frames: number, reuse?: string, heavy?: boolean, liveOnly?: boolean, exportOnly?: boolean) => acceptanceProbe(output, ffmpeg, width, height, frames, reuse, heavy, liveOnly, exportOnly) } })
void app.whenReady().then(async () => {
  const controller = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await controller.loadURL('data:text/html,<title>Web cache probe</title>')
})
