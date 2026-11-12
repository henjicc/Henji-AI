const assert = require('node:assert/strict')
const { test } = require('node:test')
const lib = require('./recordingSoak.cjs')

test('参数：默认时长按场景、冒烟档固定 3 分钟、超过 120 分钟拒绝', () => {
  assert.equal(lib.parseSoakArgs(['--scenario', 'audio']).minutes, 60)
  assert.equal(lib.parseSoakArgs(['--scenario=screen']).minutes, 30)
  assert.equal(lib.parseSoakArgs(['--scenario', 'screen', '--smoke', '--minutes', '90']).minutes, 3)
  assert.throws(() => lib.parseSoakArgs(['--scenario', 'audio', '--minutes', '121']), /1–120/)
  assert.throws(() => lib.parseSoakArgs(['--minutes', '5']), /--scenario/)
})

test('时间表：可选动作按开关加入，停止排在时长末尾', () => {
  const plain = lib.planSchedule('screen', 1800, { cursor: false })
  assert.equal(plain.at(-1).action, 'stop'); assert.equal(plain.at(-1).atSec, 1800)
  assert(!plain.some(item => ['kill-encoder', 'crash-renderer', 'cursor'].includes(item.action)))
  const full = lib.planSchedule('screen', 1800, { killEncoder: true, crashRenderer: true, cursor: true })
  assert(full.some(item => item.action === 'kill-encoder') && full.some(item => item.action === 'crash-renderer'))
  assert.equal(full.filter(item => item.action === 'cursor').length, 4)
  const audio = lib.planSchedule('audio', 3600, {})
  const minimize = audio.find(item => item.action === 'minimize'), restore = audio.find(item => item.action === 'restore')
  assert(restore.atSec - minimize.atSec >= 600, '60 分钟档最小化要超过 10 分钟')
})

test('墙钟调度：晚了立即执行并记迟到，周期任务只在动作之间跑，动作失败不打断时间表', async () => {
  let clock = 0
  const now = () => clock, sleep = async ms => { clock += ms }
  const ran = [], beats = []
  const plan = [{ atSec: 10, action: 'slow', params: {} }, { atSec: 15, action: 'boom', params: {} }, { atSec: 20, action: 'stop', params: {} }]
  const progress = []
  const records = await lib.runSchedule({
    plan, startedAtMs: 0, now, sleep,
    periodic: [{ name: 'beat', everySec: 4, run: async () => { beats.push(clock) } }],
    execute: async item => { ran.push([item.action, clock]); if (item.action === 'slow') clock += 8000; if (item.action === 'boom') throw new Error('炸了'); return { ok: true } },
    onProgress: event => progress.push(event),
  })
  assert.deepEqual(ran.map(([action]) => action), ['slow', 'boom', 'stop'])
  assert.equal(records[0].lateMs, 0)
  assert.equal(records[1].lateMs, 3000, '慢动作占到下一个动作的时间，下一个立即执行并记迟到')
  assert.equal(records[1].ok, false); assert.match(records[1].error, /炸了/)
  assert.equal(records[2].ok, true)
  assert(beats.length >= 3 && beats.every(at => !(at > 10000 && at < 18000)), '周期任务不在慢动作执行期间插进来')
  assert.equal(progress.filter(event => event.kind === 'action').length, 3)

  clock = 0
  let aborted = false
  const partial = await lib.runSchedule({ plan, startedAtMs: 0, now, sleep, shouldAbort: () => aborted, execute: async () => { aborted = true; return {} } })
  assert.equal(partial.length, 1, '中断后不再执行后面的动作')
})

test('powercfg：按段解析，只认本应用的完整路径；没有管理员权限时判为未取证', () => {
  const text = [
    'DISPLAY:', '无。', '', 'SYSTEM:', '[DRIVER] Realtek High Definition Audio', '有一个音频流正在使用。', '',
    'EXECUTION:', '[PROCESS] \\Device\\HarddiskVolume3\\VibeCode\\Henji-AI\\node_modules\\electron\\dist\\electron.exe', 'Recording in progress', '',
    '[PROCESS] \\Device\\HarddiskVolume3\\Program Files\\Other\\electron.exe', '', 'PERFBOOST:', '无。',
  ].join('\r\n')
  const parsed = lib.parsePowercfgRequests(text)
  assert.equal(parsed.available, true)
  const hits = lib.powerRequestsFor(parsed, ['\\VibeCode\\Henji-AI\\node_modules\\electron\\dist\\electron.exe'])
  assert.deepEqual(hits.map(hit => hit.section), ['EXECUTION'])
  assert.deepEqual(hits[0].detail, ['Recording in progress'])
  assert.equal(lib.parsePowercfgRequests('此操作需要管理员权限。请以管理员身份运行此命令。').available, false)
})

test('内存：录制期间某类进程持续上涨才算疑似无界增长，涨后回落不算', () => {
  const sample = (label, main, renderer) => ({ label, atMs: 0, totalPrivateBytes: main + renderer, categories: { main: { privateBytes: main }, renderer: { privateBytes: renderer } } })
  const MB = 1024 * 1024
  const growing = lib.memoryTrend([sample('before-start', 100 * MB, 300 * MB), sample('start', 200 * MB, 300 * MB), sample('periodic', 400 * MB, 600 * MB), sample('periodic', 600 * MB, 320 * MB), sample('end', 800 * MB, 310 * MB), sample('after-stop', 100 * MB, 300 * MB)])
  // 渲染进程涨了又回落，合计因此不单调，只有主进程判为持续增长。
  assert.deepEqual(growing.growing, ['main'])
  assert.equal(growing.series.main.firstBytes, 200 * MB, '开始前与停止后的样本不计入')
})

test('进程树：从主进程收集后代并按类型归类，PID 复用不成环', () => {
  const processes = [
    { ProcessId: 10, ParentProcessId: 1, Name: 'electron.exe', CommandLine: 'electron.exe .' },
    { ProcessId: 11, ParentProcessId: 10, Name: 'electron.exe', CommandLine: 'electron.exe --type=renderer' },
    { ProcessId: 12, ParentProcessId: 10, Name: 'electron.exe', CommandLine: 'electron.exe --type=utility --utility-sub-type=network.mojom.NetworkService' },
    { ProcessId: 13, ParentProcessId: 10, Name: 'henji-audio-capture.exe', CommandLine: 'x' },
    { ProcessId: 14, ParentProcessId: 13, Name: 'ffmpeg.exe', CommandLine: 'ffmpeg -filter_complex gfxcapture=window' },
    { ProcessId: 99, ParentProcessId: 2, Name: 'other.exe' },
  ]
  const tree = lib.descendants([...processes, { ProcessId: 10, ParentProcessId: 14, Name: 'dup' }], 10)
  assert.deepEqual(tree.map(item => item.ProcessId).sort(), [10, 11, 12, 13, 14])
  assert.deepEqual(tree.map(item => lib.processCategory(item, 10)).sort(), ['ffmpeg', 'henji-audio-capture', 'main', 'renderer', 'utility:network.mojom.NetworkService'])
})

test('事件读取：二分定位后只读需要的一段；光标移动按方向与时刻核对', async () => {
  const events = Array.from({ length: 10_000 }, (_, index) => ({ kind: 'cursor', monoUs: index * 10_000, point: [100, 100] }))
  // 1 秒时移到 A，1.4 秒时移到 B（事件晚 30 毫秒到）。
  for (const event of events) {
    if (event.monoUs >= 1_000_000) event.point = [500, 400]
    if (event.monoUs >= 1_430_000) event.point = [900, 800]
  }
  let calls = 0
  const reader = async (offset, limit) => { calls++; return events.slice(offset, offset + limit) }
  const window = await lib.readEventsBetween(reader, events.length, 500_000, 2_000_000)
  assert.equal(window[0].monoUs, 500_000); assert.equal(window.at(-1).monoUs, 2_000_000)
  assert(calls < 20, `读取次数 ${calls}`)
  const moved = lib.analyzeCursorMove(window, { aUs: 1_000_000, bUs: 1_400_000, holdUs: 400_000, direction: [1, 1] })
  assert.equal(moved.ok, true); assert.equal(moved.delayMs, 30)
  const reversed = lib.analyzeCursorMove(window, { aUs: 1_000_000, bUs: 1_400_000, holdUs: 400_000, direction: [-1, 1] })
  assert.equal(reversed.ok, false); assert.match(reversed.reason, /方向/)
})

test('录屏结论：没有运动源判未达测试条件；系统声重载空档、分条、无信号、重载处静音判有问题', () => {
  const result = {
    scenario: 'screen', options: { minutes: 30, motion: true },
    recording: { startedAtMs: 1, stopRequestedAtMs: 1800_000, stoppedAtMs: 1801_000, wallSeconds: 1800 },
    steps: [], heartbeats: [], memory: [],
    power: { during: { available: false, error: '需要管理员权限' } },
    logs: { warnings: [], errors: [], events: [{ timestamp: '2026-11-13T00:00:00Z', event: 'recording_power.hold.start' }, { timestamp: '2026-11-13T00:30:00Z', event: 'recording_power.hold.completed' }] },
    motion: { ok: false, reason: '找不到 ffplay' },
    checks: {
      summary: { status: 'stopped', durationUs: 1800e6, screenSpans: 3, repairedSpans: 0, rejectedSpans: 0, droppedFrames: 0, duplicatedFrames: 0, encoderRestarts: 0, eventPages: 900, events: 1e5 },
      expectedEncoderRestarts: 0, expectedFrames: 108000, expectedAudioKinds: ['microphone', 'systemAudio'],
      audioFiles: { microphone: 2, systemAudio: 1 },
      gaps: [{ kind: 'microphone', reason: 'missing-data', durationUs: 1.5e6 }],
      files: [],
      systemAudio: { summary: { outcome: 'completed', durationSeconds: 1799.8, segments: 360, silenceSeconds: 2, unavailableSeconds: 0, discontinuities: 0, droppedFrames: 0, deviceSwitches: 0, reconnects: 0, maxWriteMs: 8 }, eventCounts: {}, file: { durationSeconds: 1799.9 } },
    },
  }
  const unmet = lib.evaluateSoak(result)
  assert.equal(unmet.conditionMet, false); assert.equal(unmet.passed, false)
  assert.deepEqual(unmet.problems, [], '麦克风在重载处分两条只是已知限制')
  assert.match(lib.renderSoakMarkdown({ ...result, verdict: unmet }), /结论：未达测试条件/)

  const bad = structuredClone(result)
  bad.motion = { ok: true, source: 'ffplay', audio: true, exitedAtMs: 1802_000 }
  bad.checks.audioFiles.systemAudio = 2
  bad.checks.gaps.push({ kind: 'systemAudio', reason: 'missing-data', durationUs: 1.2e6 })
  bad.checks.systemAudio.level = { maxVolumeDb: -91 }
  bad.checks.systemAudio.reloadWindows = [{ scheduledSec: 810, silences: [{ startSeconds: 2.1, durationSeconds: 1.3 }] }]
  bad.checks.motionPicture = { changed: true }
  const verdict = lib.evaluateSoak(bad)
  assert.equal(verdict.conditionMet, true, '运动源在停止请求之后才退出，算全程在跑')
  for (const expected of ['systemAudio 拼成了 2 条', '系统声有 1 段缺数据空档', '几乎没有信号', '1.30 秒的静音']) assert(verdict.problems.some(item => item.includes(expected)), `缺少问题：${expected}`)
})

test('结论：完整的录音结果通过；丢帧、缺接管日志、禁止事件判有问题，无关错误只提示', () => {
  const base = {
    scenario: 'audio', options: { minutes: 60 },
    recording: { startedAtMs: 1, stoppedAtMs: 2, wallSeconds: 3600 },
    steps: [{ action: 'reload', scheduledSec: 1500, startedAtMs: Date.parse('2026-11-13T01:00:00Z'), ok: true, details: { before: { alive: true }, after: { alive: true } } }],
    heartbeats: [{ alive: true, atMs: 1 }],
    memory: [],
    power: { during: { available: true, hits: [{ section: 'EXECUTION', line: '[PROCESS] x' }] }, after: { available: true, hits: [] } },
    logs: {
      warnings: [], errors: [],
      events: [
        { timestamp: '2026-11-13T00:00:00Z', event: 'recording_power.hold.start' },
        { timestamp: '2026-11-13T01:00:01Z', event: 'audio_capture.owner.detached' },
        { timestamp: '2026-11-13T01:00:03Z', event: 'audio_capture.owner.attached' },
        { timestamp: '2026-11-13T01:00:03Z', event: 'audio_capture.session.attach.completed' },
        { timestamp: '2026-11-13T02:00:00Z', event: 'recording_power.hold.completed' },
      ],
    },
    checks: {
      summary: { outcome: 'completed', durationSeconds: 3599.2, elapsedSeconds: 3600, inputOverflows: 0, inputUnderflows: 0, droppedFrames: 0, droppedPreviewBlocks: 0, previewDroppedBlocks: 0, maxWriteMs: 12 },
      take: { spliced: true, insertedSeconds: 3599.3 },
      files: [{ role: '作品音频', required: true, probe: { ok: true, durationSeconds: 3599.8 } }],
    },
  }
  const good = lib.evaluateSoak(base)
  assert.deepEqual(good.problems, []); assert.equal(good.passed, true)
  assert.match(lib.renderSoakMarkdown({ ...base, verdict: good }), /结论：通过/)

  const bad = structuredClone(base)
  bad.checks.summary.droppedFrames = 480
  bad.logs.events = bad.logs.events.filter(event => event.event !== 'audio_capture.owner.attached')
  bad.logs.warnings = [{ event: 'audio_capture.recording.failed', message: '录音中断' }]
  bad.logs.errors = [{ domain: 'features.canvas', event: 'canvas.save.failed', message: '无关' }]
  const verdict = lib.evaluateSoak(bad)
  assert.equal(verdict.passed, false)
  assert(verdict.problems.some(item => item.includes('480 帧')))
  assert(verdict.problems.some(item => item.includes('audio_capture.owner.attached')))
  assert(verdict.problems.some(item => item.includes('audio_capture.recording.failed')))
  assert(verdict.notes.some(item => item.includes('canvas.save.failed')) && !verdict.problems.some(item => item.includes('canvas.save.failed')))
})
