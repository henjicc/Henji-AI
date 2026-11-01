// 显式专项：真实 Electron 读回/FFmpeg，不加入日常单测，不启动完整业务应用。
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')
const { launchElectronApp } = require('./lib/electronLaunch.cjs')

const root = path.resolve(__dirname, '..')
const ffmpeg = process.argv[2]
if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error('需显式传入本机随包 ffmpeg.exe 路径')
const output = path.join(root, '.artifacts', 'web-time-cache', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(output, { recursive: true })
const report = { output, ffmpeg,
  scopes: { throughput: 'GPU planar444 BT.709 limited → HEVC444; compositor fixture, not html-in-canvas',
    quality: 'Chromium canvas RGB truth versus GPU444 capture → HEVC444 → forced CUDA decode',
    native: 'VideoDecoderService → NVDEC → CUDA/D3D11 → production VideoFrameBridge → Chromium VideoFrame → Canvas2D; not timeline playback' },
  throughput: [], commands: [], quality: [] }
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function save() { fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2)) }

async function run(name, args) {
  const started = performance.now()
  const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill() }, 180000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timeout))
  fs.writeFileSync(path.join(output, `${name}.log`), stdout + stderr)
  report.commands.push({ name, args, code, timedOut, ms: performance.now() - started })
  save()
  return { code, text: stdout + stderr }
}

async function quality() {
  for (const sample of report.throughput.filter(item => item.status === 'measured')) {
    const { name } = sample
    const file = path.join(output, `${name}.mp4`)
    const rawPath = path.join(output, `${name}-decoded.yuv`)
    const raw = await run(`${name}-decode-planes`, ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
      '-c:v', 'hevc_cuvid', '-i', file, '-frames:v', '1', '-vf', 'hwdownload,format=yuv444p', '-f', 'rawvideo', rawPath])
    const planesIdentical = raw.code === 0 && fs.readFileSync(path.join(output, `${name}.yuv`)).equals(fs.readFileSync(rawPath))
    const decoded = await run(`${name}-decode-cuda`, ['-hide_banner', '-loglevel', 'verbose', '-y', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
      '-c:v', 'hevc_cuvid', '-i', file, '-frames:v', '1', '-vf', 'hwdownload,format=yuv444p,scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', path.join(output, `${name}.png`)])
    if (decoded.code !== 0) { report.quality.push({ name, status: 'unmeasured', stage: 'hardware-decode' }); save(); continue }
    const metric = await run(`${name}-metrics`, ['-hide_banner', '-hwaccel', 'cuda', '-i', path.join(output, `${name}-truth.png`),
      '-hwaccel', 'cuda', '-i', path.join(output, `${name}.png`), '-filter_complex',
      '[0:v]format=gbrp,split[a][c];[1:v]format=gbrp,split[b][d];[a][b]psnr[p];[c][d]ssim[s]',
      '-map', '[p]', '-map', '[s]', '-frames:v', '1', '-f', 'null', '-'])
    const psnrValue = metric.text.match(/average:(inf|[\d.]+)/)?.[1]
    const psnr = psnrValue === 'inf' ? Infinity : Number(psnrValue)
    const ssim = Number(metric.text.match(/All:([\d.]+)/)?.[1])
    if (metric.code !== 0 || Number.isNaN(psnr) || !Number.isFinite(ssim)) {
      report.quality.push({ name, status: 'unmeasured', stage: 'metrics' }); save(); continue
    }
    report.quality.push({ name, hardwareDecode: true, planesIdentical, psnr: psnr === Infinity ? 'inf' : psnr, ssim,
      status: raw.code !== 0 ? 'unmeasured' : psnr >= 45 && ssim >= .995 && (sample.qp !== 0 || planesIdentical) ? 'passed' : 'below-threshold' })
    save()
  }
}

async function nativeQuality(file) {
  const name = path.basename(file, '.mp4')
  const truth = path.join(path.dirname(file), `${name}-truth.png`)
  const decoded = path.join(output, `${name}-native.png`)
  if (!fs.existsSync(truth) || !fs.existsSync(decoded)) return { status: 'unmeasured', reason: '缺少原始RGB真值或正式共享纹理读回' }
  const metric = await run(`${name}-native-metrics`, ['-hide_banner', '-hwaccel', 'cuda', '-i', truth, '-hwaccel', 'cuda', '-i', decoded,
    '-filter_complex', '[0:v]format=gbrp,split[a][c];[1:v]format=gbrp,split[b][d];[a][b]psnr[p];[c][d]ssim[s]', '-map', '[p]', '-map', '[s]', '-frames:v', '1', '-f', 'null', '-'])
  const psnrText = metric.text.match(/average:(inf|[\d.]+)/)?.[1]
  const psnr = psnrText === 'inf' ? Infinity : Number(psnrText)
  const ssim = Number(metric.text.match(/All:([\d.]+)/)?.[1])
  const backwardsIdentical = fs.existsSync(path.join(output, `${name}-native-63.png`)) && hash(decoded) === hash(path.join(output, `${name}-native-63.png`))
  const nextFrameDifferent = fs.existsSync(path.join(output, `${name}-native-1.png`)) && hash(decoded) !== hash(path.join(output, `${name}-native-1.png`))
  return { psnr: psnr === Infinity ? 'inf' : psnr, ssim, backwardsIdentical, nextFrameDifferent,
    status: metric.code !== 0 || Number.isNaN(psnr) || !Number.isFinite(ssim) ? 'unmeasured'
      : psnr >= 45 && ssim >= .995 && backwardsIdentical && nextFrameDifferent ? 'passed' : 'below-threshold' }
}

async function main() {
  console.log(`证据目录 ${output}`)
  const mainEntry = path.join(output, 'main', 'index.cjs')
  await build({ entryPoints: [path.join(root, 'scripts/lib/webTimeCacheProbe.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: mainEntry })
  await build({ entryPoints: [path.join(root, 'scripts/lib/webTimeCacheDecodeReader.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(output, 'preload', 'decode.cjs') })
  await build({ stdin: { contents: "import { installReplayReader } from './electron/preload/web-replay-reader'; window.addEventListener('DOMContentLoaded', () => installReplayReader(), { once: true })", resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(output, 'preload', 'web-replay.cjs') })
  report.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  report.hashes = { mainBundle: hash(mainEntry), readerBundle: hash(path.join(output, 'preload', 'web-replay.cjs')), decodeReaderBundle: hash(path.join(output, 'preload', 'decode.cjs')), ffmpeg: hash(ffmpeg) }
  report.ffmpegVersion = (await run('version', ['-version'])).text
  const instance = await launchElectronApp({ mainEntry, cwd: root, isolateUserData: true, useElectronApi: true,
    extraEnv: { HENJI_WEB_CACHE_PROBE_OUTPUT: output } })
  const timer = setTimeout(() => { void instance.app.close() }, 180000)
  try {
    if (process.argv.includes('--memory-pressure-only')) {
      report.memory = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.memory(binary), ffmpeg)
      report.status = 'memory-pressure-passed'
      save(); console.log(JSON.stringify({ status: report.status, output })); return
    }
    const acceptance = process.argv.find(value => value.startsWith('--acceptance-only='))
    if (acceptance) {
      // 整体验收：主进程取帧到纹理交付的实时/缓存每帧耗时、命中与补录进度；不含渲染层合成与物理上屏。一次一个尺寸，守住单探针时限。
      const [width, height, frames = 600] = acceptance.slice('--acceptance-only='.length).split('x').map(Number)
      // --reuse-cache=<目录>：网页与已录段放在该目录跨次复用，只剖析读取时不必重录。
      const reuse = process.argv.find(value => value.startsWith('--reuse-cache='))?.slice('--reuse-cache='.length)
      report.acceptance = await instance.app.evaluate((_electron, input) => globalThis.webTimeCacheProbe.acceptance(input.ffmpeg, input.width, input.height, input.frames, input.reuse, input.heavy, input.liveOnly, input.exportOnly), { ffmpeg, width, height, frames, reuse: reuse && path.resolve(reuse), heavy: process.argv.includes('--heavy-page'), liveOnly: process.argv.includes('--live-only'), exportOnly: process.argv.includes('--exact-export-only') })
      report.status = 'acceptance-measured'
      save(); console.log(JSON.stringify({ status: report.status, output })); return
    }
    if (process.argv.includes('--reader-only')) {
      report.reader = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.scheduler(binary, false, true), ffmpeg)
      report.status = 'production-cache-reader-passed'
      save(); console.log(JSON.stringify({ status: report.status, output })); return
    }
    if (process.argv.includes('--shared-segments-only')) {
      report.segments = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.segments(binary, 1), ffmpeg)
      const decoder = path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe')
      report.hashes.nativeDecoder = hash(decoder)
      report.sharedDecode = await instance.app.evaluate((_electron, input) => globalThis.webTimeCacheProbe.sharedDecode(input.output, input.decoder, input.segments), { output, decoder, segments: report.segments })
      report.status = 'shared-segment-decode-passed'
      save(); console.log(JSON.stringify({ status: report.status, output })); return
    }
    if (process.argv.includes('--scheduler-only') || process.argv.includes('--overlap-only')) {
      const stateful = process.argv.includes('--overlap-only')
      report.scheduler = await instance.app.evaluate((_electron, input) => globalThis.webTimeCacheProbe.scheduler(input.ffmpeg, input.stateful), { ffmpeg, stateful })
      const truth = fs.readFileSync(report.scheduler.truth), frameBytes = 257 * 259 * 3
      for (const entry of report.scheduler.entries) {
        const decoded = path.join(output, `scheduler-${entry.manifest.segment.index}.yuv`)
        const result = await run(`scheduler-${entry.manifest.segment.index}-decode`, ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
          '-c:v', 'hevc_cuvid', '-i', path.join(entry.directory, 'video.mp4'), '-vf', 'hwdownload,format=yuv444p,crop=257:259:0:0', '-f', 'rawvideo', decoded])
        const { firstFrame, frameCount } = entry.manifest.segment
        if (result.code || !fs.readFileSync(decoded).equals(truth.subarray(firstFrame * frameBytes, (firstFrame + frameCount) * frameBytes))) throw new Error('正式补录段CUDA解码平面与可靠真值不同')
      }
      report.status = stateful ? 'production-overlap-fallback-passed' : 'production-scheduler-passed'
      save(); console.log(JSON.stringify({ status: report.status, published: report.scheduler.published, recordingMs: report.scheduler.recordingMs })); return
    }
    if (process.argv.includes('--activity-only')) {
      report.activity = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.activity(binary), ffmpeg)
      report.status = 'cross-process-activity-passed'
      save(); console.log(JSON.stringify(report.activity)); return
    }
    if (process.argv.includes('--environment-only')) {
      report.environmentRegistration = await instance.app.evaluate(() => globalThis.webTimeCacheProbe.environment())
      report.status = 'environment-registration-passed'
      save(); console.log(JSON.stringify(report.environmentRegistration)); return
    }
    if (process.argv.includes('--locks-only')) {
      report.locks = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.locks(binary), ffmpeg)
      report.status = 'cross-process-locks-passed'
      save(); console.log(JSON.stringify(report.locks)); return
    }
    if (process.argv.includes('--publication-only') || process.argv.includes('--preemption-only')) {
      const preempt = process.argv.includes('--preemption-only')
      report.publication = await instance.app.evaluate((_electron, input) => globalThis.webTimeCacheProbe.publication(input.ffmpeg, input.preempt), { ffmpeg, preempt })
      const decoded = path.join(output, 'published-decoded.yuv')
      const result = await run('published-decode', ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
        '-c:v', 'hevc_cuvid', '-i', path.join(report.publication.ready.directory, 'video.mp4'), '-vf', 'hwdownload,format=yuv444p,crop=257:259:0:0', '-f', 'rawvideo', decoded])
      report.publication.planesIdentical = result.code === 0 && hash(decoded) === hash(path.join(output, 'published-truth.yuv'))
      report.status = report.publication.planesIdentical ? preempt ? 'retained-recording-passed' : 'reliable-publication-passed' : 'reliable-publication-failed'
      process.exitCode = report.publication.planesIdentical ? 0 : 2
      save(); console.log(JSON.stringify(report.publication)); return
    }
    if (process.argv.includes('--snapshots-only')) {
      report.snapshots = await instance.app.evaluate(() => globalThis.webTimeCacheProbe.reliableSnapshots())
      report.status = 'reliable-snapshots-passed'
      save(); console.log(JSON.stringify(report.snapshots)); return
    }
    if (process.argv.includes('--capability-only')) {
      report.capability = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.capability(binary), ffmpeg)
      report.status = report.capability.result.available && report.capability.clean ? 'production-capability-passed' : 'production-capability-failed'
      process.exitCode = report.status === 'production-capability-passed' ? 0 : 2
      save(); console.log(JSON.stringify(report.capability)); return
    }
    if (process.argv.includes('--segments-only')) {
      report.segments = await instance.app.evaluate((_electron, binary) => globalThis.webTimeCacheProbe.segments(binary), ffmpeg)
      for (const segment of report.segments) {
        const decoded = path.join(output, `${segment.name}-decoded.yuv`)
        const result = await run(`${segment.name}-decode`, ['-hide_banner', '-loglevel', 'error', '-y', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
          '-c:v', 'hevc_cuvid', '-i', segment.file, '-vf', 'hwdownload,format=yuv444p,crop=257:259:0:0', '-f', 'rawvideo', decoded])
        segment.planesIdentical = result.code === 0 && hash(decoded) === hash(path.join(output, `${segment.name}.yuv`))
      }
      report.status = report.segments.every(segment => segment.planesIdentical) ? 'segment-contracts-passed' : 'segment-contracts-failed'
      process.exitCode = report.status === 'segment-contracts-passed' ? 0 : 2
      save(); console.log(JSON.stringify({ status: report.status, segments: report.segments })); return
    }
    const nativeOnly = process.argv.indexOf('--native-only')
    if (nativeOnly >= 0) {
      const file = path.resolve(process.argv[nativeOnly + 1])
      const decoder = path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe')
      report.hashes.nativeDecoder = hash(decoder)
      report.hashes.input = hash(file)
      report.nativeDecoder = await instance.app.evaluate((_electron, params) => globalThis.webTimeCacheProbe.nativeDecode(...params), [decoder, file])
      report.nativeQuality = await nativeQuality(file)
      report.status = report.nativeDecoder.error ? 'native-playback-unavailable' : report.nativeQuality.status === 'passed' ? 'native-texture-consumption-complete' : report.nativeQuality.status
      process.exitCode = report.nativeDecoder.error ? 4 : report.nativeQuality.status === 'passed' ? 0 : report.nativeQuality.status === 'unmeasured' ? 3 : 2
      save()
      console.log(JSON.stringify({ status: report.status, error: report.nativeDecoder.error, decoder: report.nativeDecoder.opened?.decoder }))
      return
    }
    report.environment = await instance.app.evaluate(() => globalThis.webTimeCacheProbe.truth())
    save()
    const measure = async (width, height, qp) => {
      console.log(`开始 ${width}×${height} GPU444 读回+编码 qp=${qp}`)
      try {
        const result = await instance.app.evaluate((_electron, params) => globalThis.webTimeCacheProbe.throughput(...params), [width, height, ffmpeg, qp])
        report.throughput.push({ ...result, status: 'measured' })
        console.log(JSON.stringify(result))
      } catch (error) { report.throughput.push({ width, height, qp, status: 'unmeasured', error: String(error) }); console.log(String(error)) }
      save()
    }
    for (const [width, height] of [[2560, 1440], [3840, 2160]]) await measure(width, height, 0)
    if (report.throughput.some(item => item.width === 2560 && item.mbps > 200)) {
      for (const qp of [4, 6, 8]) for (const [width, height] of [[2560, 1440], [3840, 2160]]) await measure(width, height, qp)
    }
    const decoder = path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe')
    if (fs.existsSync(decoder)) report.hashes.nativeDecoder = hash(decoder)
    report.nativeDecoder = await instance.app.evaluate((_electron, params) => globalThis.webTimeCacheProbe.nativeDecode(...params),
      [decoder, path.join(output, '2560-qp0.mp4')])
    report.nativeQuality = await nativeQuality(path.join(output, '2560-qp0.mp4'))
    save()
  } finally { clearTimeout(timer); await instance.close() }
  if (!process.argv.includes('--throughput-only')) await quality()
  const unmeasured = Boolean(report.nativeDecoder?.error) || report.nativeQuality?.status === 'unmeasured' || [...report.throughput, ...report.quality].some(item => item.status === 'unmeasured')
  const belowThreshold = report.nativeQuality?.status === 'below-threshold' || report.quality.some(item => item.status === 'below-threshold' && item.name.endsWith('-qp0'))
  const nativeHardware = report.nativeDecoder?.opened?.decoder?.hardware === true
  report.status = unmeasured ? 'incomplete-evidence' : belowThreshold ? 'stop-quality-gate' : !nativeHardware ? 'native-playback-unavailable' : process.argv.includes('--throughput-only') ? 'throughput-only' : 'candidate-probes-complete'
  process.exitCode = unmeasured ? 3 : belowThreshold ? 2 : !nativeHardware ? 4 : 0
  save()
  console.log(JSON.stringify(report.quality))
}
main().catch(error => { report.error = String(error.stack); save(); console.error(error); process.exitCode = 1 })
