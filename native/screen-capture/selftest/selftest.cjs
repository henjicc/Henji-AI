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
 *   选项：
 *     --display <设备名>   录哪块显示器（sources 返回的 id，如 \\.\DISPLAY1）；默认录非主显示器，没有就录主显示器
 *     --seconds <秒>       录制时长
 *     --codec h264|hevc    默认 h264
 *     --fps <帧率>         默认 60
 *     --out <目录>         输出目录；默认在系统临时目录下新建
 *     --motion             在被录的显示器上用 ffplay 放一块 60 帧的测试图，保证画面一直在变
 *     --no-pause           record 场景不暂停
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
const PROTOCOL = 1

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseArgs(argv) {
  const [scenario, ...rest] = argv
  const options = { scenario, motion: false, pause: true }
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index]
    if (name === '--motion') options.motion = true
    else if (name === '--no-pause') options.pause = false
    else if (name.startsWith('--')) options[name.slice(2)] = rest[++index]
  }
  return options
}

/** 采集进程的客户端：一行一条 JSON 指令；应答与事件是 u32 小端长度 + JSON + binaryBytes 字节。 */
class CaptureClient {
  constructor() {
    this.child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
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
    writeQueueMax: stats('writeQueueMax'),
    sourceIntervalUs: last.sourceIntervalUs,
    arrivalLatencyUs: last.arrivalLatencyUs,
    totals: { frames: last.frames, fresh: last.freshFrames, repeated: last.repeatedFrames, dropped: last.droppedFrames, captureDropped: last.captureDropped, sourceSurplus: last.sourceSurplus, sourceFrames: last.sourceFrames },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!['record', 'kill', 'eof', 'soak'].includes(options.scenario)) {
    console.error('用法：node native/screen-capture/selftest/selftest.cjs <record|kill|eof|soak> [选项]（见文件头）')
    process.exit(2)
  }
  if (!fs.existsSync(executable)) throw new Error('还没有构建：先运行 node scripts/build-screen-capture.cjs')
  const fps = Number(options.fps ?? 60)
  const seconds = Number(options.seconds ?? (options.scenario === 'soak' ? 300 : options.scenario === 'record' ? 60 : 12))
  const directory = options.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'henji-screen-capture-'))
  fs.mkdirSync(directory, { recursive: true })
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  const client = new CaptureClient()
  const hello = await client.request('hello', { protocol: PROTOCOL })
  const sources = await client.request('sources')
  const display = options.display
    ? sources.displays.find((candidate) => candidate.id.toLowerCase() === options.display.toLowerCase())
    : sources.displays.find((candidate) => !candidate.primary) ?? sources.displays[0]
  if (!display) throw new Error('找不到要录的显示器')
  const motion = options.motion ? startMotion(display) : null
  if (motion) await sleep(1500)

  const sessionId = `selftest-${Date.now()}`
  const prepared = await client.request('prepare', { sessionId, directory, source: { kind: 'display', id: display.id }, fps, codec: options.codec ?? 'h264' })
  await sleep(300)
  const startedAt = Date.now()
  await client.request('start', { sessionId })
  const system = watchSystem()
  let result = null
  let exit = null
  let stopMs = null

  if (options.scenario === 'record' || options.scenario === 'soak') {
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
    result = await client.request('stop', { sessionId })
    stopMs = Date.now() - stopStarted
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
    check(table.records >= fileFrames - fps, `时刻表 ${table.records} 条，比文件帧数 ${fileFrames} 少了超过一秒`)
  } else {
    // 标准输入关闭：进程自己收尾。
    check(exit.code === 0, `进程退出码 ${exit.code}`)
    check(table.manifest?.completed === true, '清单没有标记完成（没有正常收尾）')
    check(fileFrames === table.records, `文件 ${fileFrames} 帧，时刻表 ${table.records} 条`)
    check(fileFrames >= (seconds - 1) * fps, `只录到 ${fileFrames} 帧`)
  }

  const report = {
    scenario: options.scenario,
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

main().catch((error) => { console.error(error); process.exitCode = 1 })
