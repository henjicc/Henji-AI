#!/usr/bin/env node
/**
 * 画面采集进程的真实录制自测：按主进程的用法（标准输入输出上的协议）驱动它，录真实屏幕，再用 ffprobe 与 inspect 核对。
 * 同时是“主进程怎么调用它”的可运行示例。
 *
 * 用法：node native/screen-capture/selftest/selftest.cjs <场景> [选项]
 *   场景：
 *     record   录一段（默认 60 秒，第 20 秒暂停 5 秒），核对帧数、时长、色彩标记、暂停处的关键帧与时刻表
 *     kill     录到一半强杀进程，核对文件与时刻表读得回来
 *     eof      录到一半关掉标准输入（等于主进程没了），核对进程自己把文件收尾
 *     soak     长录（默认 300 秒），每秒记一次健康汇报，看丢帧、内存、显存是否平稳
 *     flash    在屏幕上放一个黑白闪烁的小色块（不抢焦点），核对时刻表里每帧的系统时刻与真实上屏时刻差多少
 *     cancel   录几秒后取消（文件应删干净），同一个进程里再录一次
 *     faults   注入故障：显示器断开再接回、编码停顿、编码持续过慢、采集出错
 *     preview  开预览，由另一个进程按句柄打开共享纹理读回
 *   选项：
 *     --display <设备名>   录哪块显示器（sources 返回的 id，如 \\.\DISPLAY1）；默认录非主显示器，没有就录主显示器
 *     --seconds <秒>       录制时长
 *     --codec h264|hevc    默认 h264
 *     --fps <帧率>         默认 60
 *     --out <目录>         输出目录；默认在系统临时目录下新建
 *     --motion             在被录的显示器上用 ffplay 放一块 60 帧的测试图，保证画面一直在变
 *     --no-pause           record 场景不暂停
 *     --proxy              同时录一份 1080P 代理，并核对它与主文件帧帧对应
 *     --cursor             flash 场景：每次变色前把鼠标移到色块里另一个角，并让系统把光标合成进画面，
 *                          量“鼠标移完”到“带上新光标位置的那一帧的系统时刻”差多少（事件与画面对齐的固定延迟）
 *
 * 需要先构建：node scripts/build-screen-capture.cjs
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { ffmpegBinDir } = require('../../../scripts/video-decoder-ffmpeg.cjs')

const crate = path.resolve(__dirname, '..')
const executable = path.join(crate, 'target', 'release', 'henji-screen-capture.exe')
const ffprobe = path.join(ffmpegBinDir, 'ffprobe.exe')
const ffplay = path.join(ffmpegBinDir, 'ffplay.exe')
const ffmpeg = path.join(ffmpegBinDir, 'ffmpeg.exe')
const PROTOCOL = 2

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv) {
  const [scenario, ...rest] = argv
  const options = { scenario, motion: false, pause: true }
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index]
    if (name === '--motion') options.motion = true
    else if (name === '--no-pause') options.pause = false
    else if (name === '--proxy') options.proxy = true
    else if (name === '--cursor') options.cursor = true
    else if (name.startsWith('--')) options[name.slice(2)] = rest[++index]
  }
  return options
}

/** 采集进程的客户端：一行一条 JSON 指令；应答与事件是 u32 小端长度 + JSON + binaryBytes 字节。 */
class CaptureClient {
  constructor(calibrateCursor = false) {
    // 故障注入要显式打开（只有自测用）。
    this.child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true, env: { ...process.env, HENJI_SCREEN_CAPTURE_INJECT: '1', ...(calibrateCursor ? { HENJI_SCREEN_CAPTURE_CALIBRATE_CURSOR: '1' } : {}) } })
    this.pending = new Map()
    this.events = []
    this.health = []
    this.nextId = 1
    this.buffer = Buffer.alloc(0)
    this.exited = new Promise((resolve) => this.child.on('exit', (code, signal) => resolve({ code, signal })))
    this.child.stdout.on('data', (chunk) => this.onData(chunk))
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 4) return
      const length = this.buffer.readUInt32LE(0)
      if (this.buffer.length < 4 + length) return
      const message = JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8'))
      const total = 4 + length + (message.binaryBytes ?? 0)
      if (this.buffer.length < total) return
      this.buffer = this.buffer.subarray(total)
      if (message.event === 'health') this.health.push(message)
      else if (message.event) this.events.push(message)
      else if (this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.ok) resolve(message.result)
        else reject(Object.assign(new Error(`${message.error.code}: ${message.error.message}`), { code: message.error.code }))
      }
    }
  }

  request(type, fields = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`)
    })
  }
}

function probe(file) {
  const result = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,avg_frame_rate,nb_read_frames,duration,color_range,color_space,color_transfer,color_primaries',
    '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return { error: result.stderr.trim() || `ffprobe 退出码 ${result.status}` }
  return JSON.parse(result.stdout).streams[0]
}

/** 每个包的 pts（以帧为单位）与是否关键帧。 */
function packets(file, fps) {
  const result = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [time, flags] = line.split(',')
    return { frame: Math.round(Number(time) * fps), key: flags.includes('K') }
  })
}

function inspect(directory) {
  const result = spawnSync(executable, ['inspect', directory], { encoding: 'utf8', windowsHide: true })
  return result.status === 0 ? JSON.parse(result.stdout) : { error: result.stderr.trim() }
}

function startMotion(display) {
  // ffplay 感知 DPI，位置与大小按物理像素给；放在被录显示器的左上角，四分之一屏大小。
  const width = Math.floor(display.width / 4) * 2
  const height = Math.floor(display.height / 4) * 2
  const child = spawn(ffplay, ['-hide_banner', '-loglevel', 'error', '-noborder', '-alwaysontop', '-window_title', '画面采集自测运动源',
    '-left', String(display.x + 40), '-top', String(display.y + 40), '-x', String(width), '-y', String(height),
    '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=60`], { stdio: 'ignore', windowsHide: false })
  return { stop: () => child.kill() }
}

/** 录制期间整机的负载（每两秒一次）：判断丢帧是采集进程自己的问题还是机器本来就忙。 */
function watchSystem() {
  const samples = []
  const cpuTimes = () => os.cpus().reduce((total, cpu) => {
    const busy = cpu.times.user + cpu.times.sys + cpu.times.irq
    return { busy: total.busy + busy, all: total.all + busy + cpu.times.idle }
  }, { busy: 0, all: 0 })
  let previous = cpuTimes()
  const timer = setInterval(() => {
    const current = cpuTimes()
    const cpu = Math.round((current.busy - previous.busy) / Math.max(1, current.all - previous.all) * 1000) / 10
    previous = current
    const query = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,utilization.encoder', '--format=csv,noheader,nounits'], { windowsHide: true })
    let output = ''
    query.stdout.on('data', (chunk) => { output += chunk })
    query.on('error', () => samples.push({ cpu }))
    query.on('close', () => {
      const [gpu, encoder] = output.trim().split(',').map((value) => Number(value))
      samples.push({ cpu, gpu, encoder })
    })
  }, 2000)
  return {
    stop() {
      clearInterval(timer)
      const stats = (key) => {
        const values = samples.map((sample) => sample[key]).filter((value) => Number.isFinite(value))
        return values.length ? { avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10, max: Math.max(...values) } : null
      }
      return { samples: samples.length, cpuPercentAllCores: stats('cpu'), gpuPercent: stats('gpu'), gpuEncoderPercent: stats('encoder') }
    },
  }
}

function readTimingTable(file) {
  const bytes = fs.readFileSync(file)
  const headerBytes = bytes.readUInt32LE(8)
  const recordBytes = bytes.readUInt32LE(12)
  const header = { fpsNum: bytes.readUInt32LE(16), fpsDen: bytes.readUInt32LE(20), originUs: Number(bytes.readBigInt64LE(24)) }
  const records = []
  for (let offset = headerBytes; offset + recordBytes <= bytes.length; offset += recordBytes) {
    records.push({ sourceUs: Number(bytes.readBigInt64LE(offset)), cell: bytes.readUInt32LE(offset + 8), flags: bytes.readUInt16LE(offset + 12) })
  }
  return { header, records }
}

/** 文件里每一帧在指定区域的平均亮度（0–255），一帧一个字节。 */
function regionLuma(video, region) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-i', video, '-vf', `crop=${region.width}:${region.height}:${region.x}:${region.y},scale=1:1:flags=area`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`ffmpeg 读不出画面：${result.stderr}`)
  return result.stdout
}

/** 文件里每一帧在指定区域里有没有东西（最亮与最暗相差很大）：纯色背景上的光标。 */
function regionContrast(video, region) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-i', video, '-vf', `crop=${region.width}:${region.height}:${region.x}:${region.y}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
    { windowsHide: true, maxBuffer: 1024 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`ffmpeg 读不出画面：${result.stderr}`)
  const size = region.width * region.height
  const present = []
  for (let offset = 0; offset + size <= result.stdout.length; offset += size) {
    let low = 255
    let high = 0
    for (let index = offset; index < offset + size; index += 1) { const value = result.stdout[index]; if (value < low) low = value; if (value > high) high = value }
    present.push(high - low > 80)
  }
  return present
}

/**
 * 闪烁色块的每次变色，对到文件里第一张带上新颜色的帧，比较“时刻表里这一帧的系统时刻”与“变色画完的时刻”。
 * 色块画完后要等合成器下一次合成、再等一次刷新才上屏，所以差值应当落在一个刷新周期宽的窗口里：
 * 窗口的宽度就是时刻表的精度。
 */
function analyzeFlash(video, timingFile, flash, region, fps, cursorBoxes) {
  const { header, records } = readTimingTable(timingFile)
  const luma = regionLuma(video, region)
  const frameUs = 1e6 / fps
  const transitions = []
  for (let frame = 1; frame < Math.min(luma.length, records.length); frame += 1) {
    if ((luma[frame] > 128) !== (luma[frame - 1] > 128)) transitions.push(frame)
  }
  const toggles = flash.ticks.map((ticks) => ticks * 1e6 / flash.frequency)
  const matched = transitions.length === toggles.length
  const stats = (values) => {
    if (!values.length) return null
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length)
    return { min: Math.round(Math.min(...values)), avg: Math.round(avg), max: Math.round(Math.max(...values)), stddev: Math.round(deviation), spreadFrames: Math.round((Math.max(...values) - Math.min(...values)) / frameUs * 100) / 100 }
  }
  const pairs = matched ? transitions.map((frame, index) => ({ frame, toggleUs: toggles[index], record: records[frame] })) : []
  // 光标合成进了画面时：鼠标每次移到色块的另一个角，找第一张光标出现在新角上的帧。
  let cursor = null
  if (cursorBoxes && flash.cursorTicks?.length) {
    const [left, right] = cursorBoxes.map((box) => regionContrast(video, box))
    const moves = []
    let previous = null
    for (let frame = 0; frame < Math.min(left.length, right.length, records.length); frame += 1) {
      const side = right[frame] ? 'right' : left[frame] ? 'left' : null
      // 录制开始时鼠标已经停在哪个角不算一次移动。
      if (side && side !== previous) { if (frame > 0) moves.push(frame); previous = side }
    }
    const sets = flash.cursorTicks.map((ticks) => ticks * 1e6 / flash.frequency)
    cursor = {
      moves: sets.length,
      movesInFile: moves.length,
      // 鼠标移完 → 带上新光标位置的那一帧的系统时刻。
      setToSourceTimeUs: moves.length === sets.length ? stats(moves.map((frame, index) => records[frame].sourceUs - sets[index])) : null,
      // 同一次里，光标比色块早多久进画面。
      beforePaintUs: matched && moves.length === sets.length ? stats(transitions.map((frame, index) => (frame - moves[index]) * frameUs)) : null,
    }
  }
  return {
    cursor,
    toggles: toggles.length,
    transitionsInFile: transitions.length,
    // 变色画完 → 时刻表里那一帧的系统时刻。
    paintToSourceTimeUs: stats(pairs.map((pair) => pair.record.sourceUs - pair.toggleUs)),
    // 变色画完 → 那一帧在文件时间轴上的位置（格时刻）。
    paintToFileTimeUs: stats(pairs.map((pair) => header.originUs + pair.record.cell * 1e6 * header.fpsDen / header.fpsNum - pair.toggleUs)),
  }
}

function summarizeHealth(samples) {
  const recording = samples.filter((sample) => sample.frames > 0)
  if (!recording.length) return null
  const column = (key) => recording.map((sample) => sample[key]).filter((value) => typeof value === 'number')
  const stats = (key) => {
    const values = column(key)
    if (!values.length) return null
    return { min: Math.min(...values), avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10, max: Math.max(...values) }
  }
  const megabytes = (range) => range && Object.fromEntries(Object.entries(range).map(([key, value]) => [key, Math.round(value / 1048576)]))
  const last = recording[recording.length - 1]
  return {
    samples: recording.length,
    cpuPercentOfOneCore: stats('cpuPercent'),
    privateMegabytes: megabytes(stats('privateBytes')),
    gpuMegabytes: megabytes(stats('gpuBytes')),
    encodeAvgUs: stats('encodeAvgUs'),
    encodeMaxUs: stats('encodeMaxUs'),
    writeMaxUs: stats('writeMaxUs'),
    captureQueueMax: stats('captureQueueMax'),
    captureMaxUs: stats('captureMaxUs'),
    writeQueueMax: stats('writeQueueMax'),
    sourceIntervalUs: last.sourceIntervalUs,
    arrivalLatencyUs: last.arrivalLatencyUs,
    totals: { frames: last.frames, fresh: last.freshFrames, repeated: last.repeatedFrames, dropped: last.droppedFrames, captureDropped: last.captureDropped, sourceSurplus: last.sourceSurplus, sourceFrames: last.sourceFrames },
  }
}

/**
 * faults：用注入的故障核对来源丢失、编码停顿、编码持续过慢、采集出错四种情况下的行为。
 * preview：开预览，由另一个进程按句柄打开纹理读回。
 */
async function runExtra(options) {
  const directory = options.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'henji-screen-capture-'))
  fs.mkdirSync(directory, { recursive: true })
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }
  const client = new CaptureClient()
  await client.request('hello', { protocol: PROTOCOL })
  const sources = await client.request('sources')
  const display = sources.displays.find((candidate) => !candidate.primary) ?? sources.displays[0]
  const sessionId = `selftest-${Date.now()}`
  // 取帧失败、换分辨率这几项要有来源帧到达才走得到：屏幕静止时系统不给帧，加 --motion 放一块一直在变的测试图。
  const motion = options.motion ? startMotion(display) : null
  if (motion) await sleep(1500)
  const prepared = await client.request('start', { sessionId, directory, source: { kind: 'display', id: display.id }, fps: 60 })
  const lastHealth = () => client.health[client.health.length - 1] ?? {}
  const report = { scenario: options.scenario, directory }

  if (options.scenario === 'preview') {
    const reader = spawn(executable, ['preview-read'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
    let output = ''
    reader.stdout.on('data', (chunk) => { output += chunk })
    const exited = new Promise((resolve) => reader.on('exit', resolve))
    await sleep(1000)
    const before = lastHealth()
    // 预览开着时再开几次（界面重载后会这样）：每次都应答，用最后一次给的句柄。
    for (let round = 0; round < 3; round += 1) await client.request('startPreview', { sessionId, clientPid: reader.pid, maxWidth: 640, fps: 30 })
    const description = await client.request('startPreview', { sessionId, clientPid: reader.pid, maxWidth: 1280, fps: 15 })
    reader.stdin.write(`${JSON.stringify(description)}\n`)
    await exited
    const read = JSON.parse(output || '{"error":"没有输出"}')
    await sleep(2500)
    const previews = client.events.filter((event) => event.event === 'preview')
    await client.request('stopPreview', { sessionId })
    const result = await client.request('stop', { sessionId })
    check(!read.error && read.opened === description.slots.length, `另一个进程打不开预览纹理：${JSON.stringify(read).slice(0, 200)}`)
    // 屏幕上没东西在动时每张预览都一样，这时只核对读得到画面。
    check(read.nonblank, '预览纹理读回来是空的')
    check(description.codedSize.width === 1280, `预览宽 ${description.codedSize.width}`)
    check(result.droppedFrames === 0 && result.captureDropped === 0, `开预览期间丢帧：${result.droppedFrames} / ${result.captureDropped}`)
    // 预览事件是可丢的；这里只看它确实在以大致的帧率到达。
    check(previews.length >= 20, `预览事件只有 ${previews.length} 条`)
    Object.assign(report, { description, read: { ...read, rounds: undefined }, previewEvents: previews.length, encodeAvgUsBefore: before.encodeAvgUs, encodeAvgUsDuring: lastHealth().encodeAvgUs, captureMaxUs: summarizeHealth(client.health)?.captureMaxUs, result })
  } else {
    const inject = (fields) => client.request('inject', { sessionId, ...fields })
    const waitEvent = async (name, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (client.events.some((event) => event.event === name)) return true
        await sleep(50)
      }
      return false
    }
    await sleep(3000)
    // 一、显示器断开再接回：同一个文件里续录，中间是一段空档。
    await inject({ kind: 'sourceLost' })
    check(await waitEvent('sourceRestored', 5000), '来源丢失后没有恢复')
    await sleep(2000)
    const afterLost = lastHealth()
    // 显示器换分辨率：把帧池换成一半大小，下一张来源帧的内容尺寸与帧池对不上，走的就是真换分辨率时的那条路
    // （丢掉这一帧、按内容尺寸重建帧池）。先报一次一半的尺寸，重建后再报回实际尺寸；录制不中断，输出尺寸不变。
    const framesBeforeResize = lastHealth().frames
    await inject({ kind: 'resize' })
    await sleep(2500)
    const resized = client.events.filter((event) => event.event === 'sourceChanged')
    // 尺寸是会话线程每轮比一次：下一张来源帧来得太快时，它可能还没看到一半的尺寸就已经改回来，这时一次都不报。
    // 帧池要是没按实际尺寸重建好，之后每一帧都对不上、不会有新帧进文件，由下一条核对。
    check(resized.length === 0 || (resized.length === 2 && resized[1].width === prepared.width && resized[1].height === prepared.height), `换分辨率后应报两次尺寸变化并回到 ${prepared.width}×${prepared.height}：${JSON.stringify(resized.map((event) => [event.width, event.height]))}`)
    check(Boolean(motion), '换分辨率这一项要加 --motion（屏幕静止时没有来源帧，走不到重建）')
    check(lastHealth().frames > framesBeforeResize + 60, '帧池重建后没有接着录')
    check(client.events.filter((event) => event.event === 'sourceLost').length === 1, '帧池重建被当成了来源丢失')
    // 偶发的取帧失败（5 张）：只丢这几张，不中断、不当成来源丢失。
    await inject({ kind: 'frameFailures', count: 5 })
    await sleep(1500)
    check(lastHealth().captureFailed === 5, `注入 5 张取帧失败，计数是 ${lastHealth().captureFailed}`)
    check(client.events.filter((event) => event.event === 'sourceLost').length === 1, '偶发的取帧失败被当成了来源丢失')
    // 连着失败一秒以上（90 张）：升级为重新接上采集，同一文件续录。
    await inject({ kind: 'frameFailures', count: 90 })
    await sleep(4500)
    check(client.events.filter((event) => event.event === 'sourceRestored').length === 2, '连续取帧失败后没有重新接上采集')
    await inject({ kind: 'frameFailures', count: 0 })
    // 二、编码停顿 150 毫秒一次：两个队列吸收，一帧不丢。
    await inject({ kind: 'encodeStall', ms: 150 })
    await sleep(2500)
    const afterStall = lastHealth()
    check(afterStall.droppedFrames === 0 && afterStall.captureDropped === 0, `150 毫秒的编码停顿丢了帧：丢格 ${afterStall.droppedFrames}，采集丢 ${afterStall.captureDropped}`)
    // 三、编码器持续过慢（每帧多 25 毫秒，一秒只编得了约 30 帧）：队列满后按规则丢格，采集回调不受影响。
    await inject({ kind: 'encodeDelay', ms: 25 })
    await sleep(5000)
    const slow = lastHealth()
    await inject({ kind: 'encodeDelay', ms: 0 })
    await sleep(3000)
    const recovered = lastHealth()
    check(slow.droppedFrames > 60, `编码过慢 5 秒只丢了 ${slow.droppedFrames} 格`)
    check(slow.captureDropped === 0, `编码过慢时采集队列丢了 ${slow.captureDropped} 张（会话线程被卡住了）`)
    check(recovered.encodeQueue <= 2, `编码恢复后队列还有 ${recovered.encodeQueue} 帧`)
    const droppedAtEnd = (await client.request('status', { sessionId })).droppedFrames
    await sleep(1500)
    check((await client.request('status', { sessionId })).droppedFrames === droppedAtEnd, '编码恢复后还在丢格')
    // 四、采集报设备被移除：收尾并发 interrupted，已录内容可读。
    await inject({ kind: 'captureFailure', code: 'DEVICE_REMOVED' })
    check(await waitEvent('interrupted', 5000), '采集出错后没有 interrupted 事件')
    const interrupted = client.events.find((event) => event.event === 'interrupted')
    check(interrupted?.error?.code === 'DEVICE_REMOVED', `interrupted 的错误码是 ${interrupted?.error?.code}`)
    const stopOutcome = await client.request('stop', { sessionId }).then(() => 'ok', (error) => error.code)
    check(stopOutcome === 'SESSION_MISSING', `中断后的 stop 应被拒绝，实际 ${stopOutcome}`)
    const stream = probe(path.join(directory, prepared.files.video))
    const table = inspect(directory)
    check(stream.width === prepared.width && stream.height === prepared.height, `文件尺寸 ${stream.width}×${stream.height}，应为 ${prepared.width}×${prepared.height}`)
    check(!stream.error && Number(stream.nb_read_frames) === interrupted?.encodedFrames, `文件 ${stream.nb_read_frames} 帧，中断事件说编码了 ${interrupted?.encodedFrames} 帧`)
    check(table.records === interrupted?.frames, `时刻表 ${table.records} 条，应为 ${interrupted?.frames}`)
    check(table.droppedFrames === interrupted?.droppedFrames, '时刻表里的丢弃数与事件不一致')
    check(table.pauses?.length === 2 && table.pauses.every((pause) => pause.keyframe), `应有两处空档且之后都是关键帧：${JSON.stringify(table.pauses)}`)
    const paused = client.events.find((event) => event.event === 'paused')
    check(paused?.reason === 'sourceLost', `paused 的原因是 ${paused?.reason}`)
    Object.assign(report, {
      events: client.events.filter((event) => !['fragment', 'preview'].includes(event.event)).map((event) => ({ event: event.event, reason: event.reason, frame: event.frame, ...(event.event === 'sourceChanged' ? { width: event.width, height: event.height } : {}) })),
      afterLost: { frames: afterLost.frames, pausedCells: afterLost.pausedCells },
      afterStall: { dropped: afterStall.droppedFrames, captureDropped: afterStall.captureDropped },
      slow: { dropped: slow.droppedFrames, captureDropped: slow.captureDropped, encodeQueue: slow.encodeQueue },
      recovered: { dropped: recovered.droppedFrames, encodeQueue: recovered.encodeQueue },
      health: summarizeHealth(client.health),
      file: { frames: stream.nb_read_frames, duration: stream.duration },
      timing: { records: table.records, dropped: table.droppedFrames, pauses: table.pauses },
    })
  }
  motion?.stop()
  client.child.stdin.end()
  report.exit = await client.exited
  check(report.exit.code === 0, `进程退出码 ${report.exit.code}`)
  report.ok = problems.length === 0
  report.problems = problems
  fs.writeFileSync(path.join(directory, 'selftest-report.json'), JSON.stringify({ ...report, healthSamples: client.health }, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (['faults', 'preview'].includes(options.scenario)) return runExtra(options)
  if (!['record', 'kill', 'eof', 'soak', 'flash', 'cancel'].includes(options.scenario)) {
    console.error('用法：node native/screen-capture/selftest/selftest.cjs <record|kill|eof|soak|flash|cancel> [选项]（见文件头）')
    process.exit(2)
  }
  if (!fs.existsSync(executable)) throw new Error('还没有构建：先运行 node scripts/build-screen-capture.cjs')
  const fps = Number(options.fps ?? 60)
  const seconds = Number(options.seconds ?? ({ soak: 300, record: 60, cancel: 5 }[options.scenario] ?? 12))
  const directory = options.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'henji-screen-capture-'))
  fs.mkdirSync(directory, { recursive: true })
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  const client = new CaptureClient(options.cursor)
  const hello = await client.request('hello', { protocol: PROTOCOL })
  const sources = await client.request('sources')
  const display = options.display
    ? sources.displays.find((candidate) => candidate.id.toLowerCase() === options.display.toLowerCase())
    : sources.displays.find((candidate) => !candidate.primary) ?? sources.displays[0]
  if (!display) throw new Error('找不到要录的显示器')
  const motion = options.motion ? startMotion(display) : null
  if (motion) await sleep(1500)

  let sessionId = `selftest-${Date.now()}`
  const parameters = { directory, source: { kind: 'display', id: display.id }, fps, codec: options.codec ?? 'h264', ...(options.proxy ? { proxy: { height: 1080 } } : {}) }
  let prepared = await client.request('prepare', { sessionId, ...parameters })
  await sleep(300)
  const rejected = async (type, code) => {
    const outcome = await client.request(type, { sessionId }).then(() => 'ok', (error) => error.code)
    check(code.split('|').includes(outcome), `${type} 此时应被拒绝为 ${code}，实际 ${outcome}`)
  }
  if (options.scenario === 'cancel') await rejected('pause', 'INVALID_STATE')
  let startedAt = Date.now()
  await client.request('start', { sessionId })
  if (options.scenario === 'cancel') await rejected('start', 'INVALID_STATE')
  if (options.scenario === 'cancel') {
    // 录三秒后取消：文件应全部删掉；同一个进程里紧接着再录一次（不先 prepare，直接带参数 start）应当正常。
    await sleep(3000)
    await client.request('cancel', { sessionId })
    const left = fs.readdirSync(directory)
    check(left.length === 0, `取消后目录里还留着：${left.join('、')}`)
    const status = await client.request('status', { sessionId })
    check(status.state === 'ended', `取消后的状态是 ${status.state}`)
    sessionId = `${sessionId}-again`
    startedAt = Date.now()
    prepared = await client.request('start', { sessionId, ...parameters })
  }
  const system = watchSystem()
  let result = null
  let exit = null
  let stopMs = null

  let flash = null
  // 闪烁色块放在被录显示器的右上角；只取中间一块量亮度，避开边缘。
  const flashWindow = { x: display.x + display.width - 520, y: display.y + 120, size: 400 }
  const flashRegion = { x: flashWindow.x - display.x + 100, y: flashWindow.y - display.y + 100, width: 200, height: 200 }
  // 鼠标轮流停在色块左下、右下两个角（flash.ps1 里同样的位置）；光标从停的点向右下画出。
  const cursorBoxes = options.cursor ? [60, flashWindow.size - 60].map((offset) => ({ x: flashWindow.x - display.x + offset - 4, y: flashWindow.y - display.y + flashWindow.size - 64, width: 60, height: 60 })) : null

  if (options.scenario === 'flash') {
    const flashFile = path.join(directory, 'flash.json')
    await sleep(500)
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'flash.ps1'),
      '-X', String(flashWindow.x), '-Y', String(flashWindow.y), '-Size', String(flashWindow.size), '-Count', String(options.count ?? 40), '-Out', flashFile, ...(options.cursor ? ['-Cursor'] : [])], { encoding: 'utf8', windowsHide: true })
    if (run.status !== 0) problems.push(`闪烁色块没跑起来：${run.stderr}`)
    else flash = JSON.parse(fs.readFileSync(flashFile, 'utf8'))
    await sleep(500)
    result = await client.request('stop', { sessionId })
    client.child.stdin.end()
    exit = await client.exited
  } else if (['record', 'soak', 'cancel'].includes(options.scenario)) {
    if (options.scenario === 'record' && options.pause && seconds > 30) {
      await sleep(20_000)
      await client.request('pause', { sessionId })
      await sleep(5_000)
      await client.request('resume', { sessionId })
      await sleep((seconds - 20) * 1000)
    } else {
      await sleep(seconds * 1000)
    }
    const stopStarted = Date.now()
    // 停止在途时再发一次停止：第二条应被拒绝，第一条照常应答。
    const first = client.request('stop', { sessionId })
    // 第二条到的时候录制可能正在结束，也可能已经结束，两种拒绝都对。
    const second = options.scenario === 'cancel' ? rejected('stop', 'INVALID_STATE|SESSION_MISSING') : null
    result = await first
    stopMs = Date.now() - stopStarted
    await second
    if (options.scenario === 'cancel') await rejected('pause', 'SESSION_MISSING')
    client.child.stdin.end()
    exit = await client.exited
  } else if (options.scenario === 'kill') {
    await sleep(seconds * 1000)
    client.child.kill('SIGKILL')
    exit = await client.exited
  } else {
    await sleep(seconds * 1000)
    client.child.stdin.end()
    exit = await client.exited
  }
  motion?.stop()
  const systemLoad = system.stop()
  const wallSeconds = Math.round((Date.now() - startedAt) / 100) / 10

  const video = path.join(directory, prepared.files.video)
  const stream = probe(video)
  const table = inspect(directory)
  const fragments = client.events.filter((event) => event.event === 'fragment')
  const lastFragment = fragments[fragments.length - 1]
  check(!stream.error, `ffprobe 读不了文件：${stream.error}`)
  check(!table.error, `读不了逐帧时刻表：${table.error}`)
  if (!stream.error) {
    check(stream.color_space === 'bt709' && stream.color_range === 'tv' && stream.color_primaries === 'bt709' && stream.color_transfer === 'bt709', `色彩标记不对：${JSON.stringify(stream)}`)
    check(stream.avg_frame_rate === `${fps}/1`, `平均帧率 ${stream.avg_frame_rate}，应为 ${fps}/1`)
    check(stream.width === prepared.width && stream.height === prepared.height, '文件尺寸与准备时报的不一致')
  }
  const fileFrames = Number(stream.nb_read_frames ?? 0)
  if (result) {
    check(fileFrames === result.encodedFrames, `文件里 ${fileFrames} 帧，采集进程说编码了 ${result.encodedFrames} 帧`)
    check(table.records === result.frames, `时刻表 ${table.records} 条，应为 ${result.frames} 条`)
    check(result.droppedFrames === 0, `丢弃了 ${result.droppedFrames} 格`)
    check(result.captureDropped === 0, `采集队列丢了 ${result.captureDropped} 张`)
    check(Math.abs(Number(stream.duration) - result.frames / fps) < 0.05, `文件时长 ${stream.duration}，应约为 ${result.frames / fps}`)
    check(table.manifest?.completed === true, '清单没有标记完成')
    check(exit.code === 0, `进程退出码 ${exit.code}`)
    if (options.scenario === 'record' && options.pause && seconds > 30) {
      check(table.pauses?.length === 1, `时刻表里应有 1 处暂停，实际 ${table.pauses?.length}`)
      const pause = table.pauses?.[0]
      if (pause) {
        check(Math.abs(pause.pausedCells - 5 * fps) <= 3, `暂停了 ${pause.pausedCells} 格，应约为 ${5 * fps}`)
        check(pause.keyframe && pause.afterResumeFlag, '继续后的第一帧没有标成关键帧')
        const packet = packets(video, fps).find((candidate) => candidate.frame === pause.frame)
        check(packet?.key === true, `文件里第 ${pause.frame} 帧（继续后的第一帧）不是关键帧`)
        const paused = client.events.find((event) => event.event === 'paused')
        const resumed = client.events.find((event) => event.event === 'resumed')
        check(paused?.frame === pause.frame && resumed?.frame === pause.frame, '暂停、继续事件里的帧序号与时刻表不一致')
      }
      check(Math.abs(result.frames - (seconds - 0) * fps) <= fps, `录了 ${result.frames} 帧，应约为 ${seconds * fps}`)
    }
  } else if (options.scenario === 'kill') {
    // 被强杀：文件应能读到最后一个落盘的分片，时刻表不比文件短太多。
    check(fileFrames > 0, '强杀后文件里没有可读的帧')
    check(lastFragment && fileFrames >= lastFragment.frames, `强杀后只读到 ${fileFrames} 帧，少于最后一次落盘事件报的 ${lastFragment?.frames} 帧`)
    check(fileFrames >= (seconds - 2.5) * fps, `强杀后读到 ${fileFrames} 帧，比录制时长少了超过两秒半`)
    check(table.records >= fileFrames, `时刻表 ${table.records} 条，少于文件里读得回来的 ${fileFrames} 帧`)
  } else {
    // 标准输入关闭：进程自己收尾。
    check(exit.code === 0, `进程退出码 ${exit.code}`)
    check(table.manifest?.completed === true, '清单没有标记完成（没有正常收尾）')
    check(fileFrames === table.records, `文件 ${fileFrames} 帧，时刻表 ${table.records} 条`)
    check(fileFrames >= (seconds - 1) * fps, `只录到 ${fileFrames} 帧`)
  }

  let proxyFile = null
  if (options.proxy) {
    // 代理与主文件帧帧对应：帧数、时长相同，尺寸是 1080P。
    check(prepared.proxy?.height === 1080 && prepared.files.proxy, '准备的应答里没有代理')
    if (result) check(result.proxyFrames === result.encodedFrames, '停止结果里代理 ' + result.proxyFrames + ' 帧，主文件 ' + result.encodedFrames + ' 帧')
    proxyFile = prepared.files.proxy ? probe(path.join(directory, prepared.files.proxy)) : { error: '没有代理文件' }
    check(!proxyFile.error && proxyFile.height === 1080 && proxyFile.width === prepared.proxy?.width, '代理文件读不了或尺寸不对：' + JSON.stringify(proxyFile).slice(0, 160))
    check(proxyFile.nb_read_frames === stream.nb_read_frames && proxyFile.duration === stream.duration, '代理 ' + proxyFile.nb_read_frames + ' 帧 / ' + proxyFile.duration + ' 秒，主文件 ' + stream.nb_read_frames + ' 帧 / ' + stream.duration + ' 秒')
    if (table.pauses?.[0]) check(packets(path.join(directory, prepared.files.proxy), fps).find((candidate) => candidate.frame === table.pauses[0].frame)?.key === true, '代理里继续后的第一帧不是关键帧')
  }
  let flashResult = null
  if (flash && !stream.error && !table.error) {
    flashResult = analyzeFlash(video, path.join(directory, prepared.files.timing), flash, flashRegion, fps, cursorBoxes)
    check(flashResult.transitionsInFile === flashResult.toggles, `色块变了 ${flashResult.toggles} 次，文件里看到 ${flashResult.transitionsInFile} 次`)
    const spread = flashResult.paintToSourceTimeUs
    if (spread) {
      check(spread.min > 0, `有的帧的系统时刻早于它画面里那次变色（最小 ${spread.min} 微秒）`)
      check(spread.spreadFrames <= 1.5, `变色到上屏时刻的差值散布 ${spread.spreadFrames} 帧，超过一帧半`)
    }
  }

  const report = {
    scenario: options.scenario,
    flash: flashResult,
    proxy: proxyFile && { width: proxyFile.width, height: proxyFile.height, frames: proxyFile.nb_read_frames, duration: proxyFile.duration, bytes: prepared.files.proxy && fs.existsSync(path.join(directory, prepared.files.proxy)) ? fs.statSync(path.join(directory, prepared.files.proxy)).size : 0 },
    ok: problems.length === 0,
    problems,
    directory,
    display,
    handshake: { protocol: hello.protocol, platform: hello.platform },
    prepared: { width: prepared.width, height: prepared.height, fps: prepared.fps, encoder: prepared.encoder },
    wallSeconds,
    stopMs,
    exit,
    result,
    file: { ...stream, bytes: fs.existsSync(video) ? fs.statSync(video).size : 0 },
    timing: table.error ? table : { records: table.records, fresh: table.freshFrames, repeated: table.repeatedFrames, dropped: table.droppedFrames, pauses: table.pauses, freshIntervalUs: table.freshIntervalUs, longGaps: table.freshIntervalsOverOneAndHalfFrames, freshDelayUs: table.freshDelayUs, monotonic: table.sourceTimesMonotonic },
    health: summarizeHealth(client.health),
    systemLoad,
    events: client.events.filter((event) => event.event !== 'fragment'),
    fragments: { count: fragments.length, last: lastFragment },
  }
  fs.writeFileSync(path.join(directory, 'selftest-report.json'), JSON.stringify({ ...report, healthSamples: client.health }, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.ok ? 0 : 1
}

// 出错时直接退出：标准输入随之关闭，采集进程会自己收尾退出。
main().catch((error) => { console.error(error); process.exit(1) })
