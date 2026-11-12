'use strict'

/**
 * 无人值守长录测试的纯逻辑：参数、时间表、按墙钟调度、powercfg 解析、内存趋势、事件对齐与结论汇总。
 * 不碰应用和系统，便于用假数据自测；驱动应用的部分在 recordingSoakDriver.cjs。
 */

const SCENARIOS = ['audio', 'screen']
const DEFAULT_MINUTES = { audio: 60, screen: 30 }
const SMOKE_MINUTES = 3
const MAX_MINUTES = 120

function parseSoakArgs(argv) {
  const flags = new Set(['smoke', 'kill-encoder', 'crash-renderer', 'no-cursor', 'no-system-audio', 'no-microphone', 'no-motion', 'help'])
  const values = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`)
    const [rawKey, inline] = token.slice(2).split(/=(.*)/s)
    if (flags.has(rawKey)) { values[rawKey] = true; continue }
    const value = inline !== undefined ? inline : argv[++index]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${rawKey} 需要一个值`)
    values[rawKey] = value
  }
  if (values.help) return { help: true }
  const scenario = values.scenario
  if (!SCENARIOS.includes(scenario)) throw new Error('需要 --scenario audio 或 --scenario screen')
  const number = (key, fallback, min, max) => {
    if (values[key] === undefined) return fallback
    const parsed = Number(values[key])
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`--${key} 应在 ${min}–${max} 之间`)
    return parsed
  }
  const minutes = values.smoke ? SMOKE_MINUTES : number('minutes', DEFAULT_MINUTES[scenario], 1, MAX_MINUTES)
  const width = number('width', 3840, 2, 3840), height = number('height', 2160, 2, 2160)
  if (width % 2 || height % 2) throw new Error('--width/--height 需要是偶数')
  const fps = number('fps', 60, 30, 60)
  if (fps !== 30 && fps !== 60) throw new Error('--fps 只能是 30 或 60')
  return {
    scenario, minutes, smoke: Boolean(values.smoke),
    port: number('port', 9334, 1, 65535),
    project: values.project ?? '长录测试',
    out: values.out ?? null,
    source: values.source ?? null,
    width, height, fps,
    systemAudio: !values['no-system-audio'],
    microphone: !values['no-microphone'],
    killEncoder: Boolean(values['kill-encoder']),
    crashRenderer: Boolean(values['crash-renderer']),
    cursor: !values['no-cursor'],
    motion: scenario === 'screen' && !values['no-motion'],
    loadSeconds: number('load-seconds', 20, 1, 300),
  }
}

/**
 * 施压时间表：按录制时长的比例排，3 分钟冒烟档与 2 小时档走同一张表。
 * 最小化留在 0.10–0.27（60 分钟时约 10 分钟），停止放在时长末尾、从标题栏或正式能力发起。
 */
const PLANS = {
  audio: [
    [0.03, 'wake-lock'],
    [0.05, 'switch-away', { workspaceId: 'videoEdit' }],
    [0.08, 'switch-back'],
    [0.10, 'minimize'],
    [0.27, 'restore'],
    [0.32, 'main-load'],
    [0.42, 'reload'],
    [0.50, 'status', { memoryLabel: 'mid' }],
    [0.56, 'crash-renderer', { option: 'crashRenderer' }],
    [0.70, 'switch-away', { workspaceId: 'assets' }],
  ],
  screen: [
    [0.03, 'wake-lock'],
    [0.06, 'cursor'],
    [0.12, 'switch-away', { workspaceId: 'videoEdit' }],
    [0.18, 'switch-back'],
    [0.28, 'main-load'],
    [0.38, 'cursor'],
    [0.45, 'reload'],
    [0.52, 'status', { memoryLabel: 'mid' }],
    [0.60, 'kill-encoder', { option: 'killEncoder' }],
    [0.70, 'cursor'],
    [0.78, 'crash-renderer', { option: 'crashRenderer' }],
    [0.85, 'switch-away', { workspaceId: 'assets' }],
    [0.93, 'cursor'],
  ],
}

function planSchedule(scenario, durationSec, options = {}) {
  const plan = PLANS[scenario]
  if (!plan) throw new Error(`未知场景：${scenario}`)
  const items = []
  for (const [fraction, action, params = {}] of plan) {
    if (params.option && !options[params.option]) continue
    if (action === 'cursor' && options.cursor === false) continue
    const rest = Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'option'))
    items.push({ atSec: Math.round(fraction * durationSec * 10) / 10, action, params: rest })
  }
  items.push({ atSec: durationSec, action: 'stop', params: {} })
  return items
}

/** 加压时长：冒烟档按时长缩短，免得一次加压占掉大半段录制。 */
function loadSecondsFor(durationSec, requested) {
  return Math.max(3, Math.min(requested, Math.round(durationSec * 0.05)))
}

/** 周期任务的间隔：存活检查约每分钟（短档 15 秒），内存约 12 次。 */
function periodicIntervals(durationSec) {
  return { heartbeatSec: Math.max(15, Math.min(60, Math.round(durationSec / 12))), memorySec: Math.max(30, Math.round(durationSec / 12)) }
}

/**
 * 按墙钟调度：动作逐个串行执行，晚了就立即执行并记下迟到；周期任务只在动作之间运行。
 * 不依赖页面里的定时器，页面重载不影响时间表。动作抛错只记录，不打断时间表。
 */
async function runSchedule({ plan, startedAtMs, now, sleep, execute, periodic = [], shouldAbort = () => false, onProgress = () => {} }) {
  const records = []
  const queue = [...plan].sort((a, b) => a.atSec - b.atSec)
  const timers = periodic.map(task => ({ ...task, nextMs: startedAtMs + task.everySec * 1000 }))
  while (queue.length) {
    if (shouldAbort()) break
    const next = queue[0]
    const dueMs = startedAtMs + next.atSec * 1000
    const current = now()
    const timer = timers.filter(item => item.nextMs <= current).sort((a, b) => a.nextMs - b.nextMs)[0]
    if (timer && current < dueMs) {
      try { await timer.run() } catch (error) { onProgress({ kind: 'periodic-failed', name: timer.name, error: String(error?.message ?? error) }) }
      timer.nextMs = Math.max(timer.nextMs + timer.everySec * 1000, now())
      continue
    }
    if (current < dueMs) {
      const nextTimer = Math.min(...timers.map(item => item.nextMs), Infinity)
      await sleep(Math.max(1, Math.min(1000, dueMs - current, nextTimer - current)))
      continue
    }
    queue.shift()
    const record = { action: next.action, params: next.params, scheduledSec: next.atSec, lateMs: Math.round(current - dueMs), startedAtMs: current }
    try {
      record.details = await execute(next)
      record.ok = record.details?.ok !== false
    } catch (error) {
      record.ok = false
      record.error = String(error?.stack ?? error?.message ?? error).slice(0, 2000)
    }
    record.endedAtMs = now()
    records.push(record)
    onProgress({ kind: 'action', record })
  }
  return records
}

/** powercfg /requests 输出按段解析；条目是方括号开头的行，后面紧跟的非空行是它的说明。 */
function parsePowercfgRequests(text) {
  const sections = {}
  let section = null, last = null
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^([A-Z]+):$/.exec(line)
    if (header) { section = header[1]; sections[section] = []; last = null; continue }
    if (!section || !line) { last = null; continue }
    if (line.startsWith('[')) { last = { line, detail: [] }; sections[section].push(last); continue }
    if (last) last.detail.push(line)
  }
  return { available: Object.keys(sections).length > 0, sections }
}

/** 本应用在哪些段里有请求；按主进程可执行文件名比对（大小写不敏感）。 */
function powerRequestsFor(parsed, exeNames) {
  const names = exeNames.filter(Boolean).map(name => name.toLowerCase())
  const hits = []
  for (const [section, entries] of Object.entries(parsed.sections)) {
    for (const entry of entries) {
      const text = [entry.line, ...entry.detail].join(' ').toLowerCase()
      if (names.some(name => text.includes(name))) hits.push({ section, line: entry.line, detail: entry.detail })
    }
  }
  return hits
}

/** 进程树：从主进程往下收集全部后代。 */
function descendants(processes, rootPid) {
  const children = new Map()
  for (const process of processes) {
    const list = children.get(process.ParentProcessId) ?? []
    list.push(process); children.set(process.ParentProcessId, list)
  }
  const root = processes.find(process => process.ProcessId === rootPid)
  const result = root ? [root] : []
  const seen = new Set(result.map(process => process.ProcessId))
  for (let index = 0; index < result.length; index++) {
    for (const child of children.get(result[index].ProcessId) ?? []) {
      // Windows 会复用 PID：子进程的父 PID 可能指向一个早已退出、编号被复用的进程，用 seen 防环。
      if (seen.has(child.ProcessId)) continue
      seen.add(child.ProcessId); result.push(child)
    }
  }
  return result
}

function processCategory(process, mainPid) {
  if (process.ProcessId === mainPid) return 'main'
  const command = process.CommandLine ?? ''
  const type = /--type=([\w-]+)/.exec(command)?.[1]
  if (type === 'utility') return `utility:${/--utility-sub-type=([\w.-]+)/.exec(command)?.[1] ?? 'unknown'}`
  if (type) return type
  return String(process.Name ?? 'unknown').toLowerCase().replace(/\.exe$/, '')
}

function memorySample(processes, mainPid, label, atMs) {
  const tree = descendants(processes, mainPid)
  const categories = {}
  for (const process of tree) {
    const category = processCategory(process, mainPid)
    const entry = categories[category] ?? (categories[category] = { count: 0, privateBytes: 0, workingSetBytes: 0 })
    entry.count += 1
    entry.privateBytes += Number(process.PrivatePageCount ?? 0)
    entry.workingSetBytes += Number(process.WorkingSetSize ?? 0)
  }
  const totalPrivateBytes = Object.values(categories).reduce((sum, entry) => sum + entry.privateBytes, 0)
  return { label, atMs, processCount: tree.length, totalPrivateBytes, categories }
}

/**
 * 内存是否无界增长：录制期间（开始到结束前）的样本里，某类进程从第一个样本到最后一个涨了
 * 超过 max(256 MB, 50%)，并且最后三个样本仍在单调上涨，才算疑似持续增长。
 */
function memoryTrend(samples, { minBytes = 256 * 1024 * 1024, ratio = 0.5 } = {}) {
  const during = samples.filter(sample => sample.label !== 'after-stop' && sample.label !== 'before-start')
  const categories = new Set(during.flatMap(sample => Object.keys(sample.categories)))
  const series = {}
  const growing = []
  for (const category of [...categories, 'total']) {
    const values = during.map(sample => category === 'total' ? sample.totalPrivateBytes : sample.categories[category]?.privateBytes).filter(value => Number.isFinite(value))
    if (values.length < 2) continue
    const first = values[0], last = values.at(-1), max = Math.max(...values)
    const tail = values.slice(-3)
    const rising = tail.length === 3 && tail[0] <= tail[1] && tail[1] <= tail[2]
    const grew = last - first
    series[category] = { firstBytes: first, lastBytes: last, maxBytes: max, growthBytes: grew, samples: values.length }
    if (grew > Math.max(minBytes, first * ratio) && rising) growing.push(category)
  }
  return { series, growing }
}

/** 二分查找到 monoUs 不早于 fromUs 的第一个事件，再顺读到 toUs。reader(offset, limit) 返回事件数组。 */
async function readEventsBetween(reader, totalEvents, fromUs, toUs, pageSize = 256) {
  let lo = 0, hi = totalEvents
  while (hi - lo > pageSize) {
    const mid = Math.floor((lo + hi) / 2)
    const [event] = await reader(mid, 1)
    if (!event) { hi = mid; continue }
    if (event.monoUs < fromUs) lo = mid; else hi = mid
  }
  const events = []
  for (let offset = lo; offset < totalEvents; offset += pageSize) {
    const page = await reader(offset, pageSize)
    if (!page.length) break
    for (const event of page) if (event.monoUs >= fromUs && event.monoUs <= toUs) events.push(event)
    if (page.at(-1).monoUs > toUs) break
  }
  return events
}

/**
 * 光标移动对齐：脚本在已知时刻把光标从 A 移到 B。事件里 B 段的位置应与 A 段相对方向一致，
 * 出现时刻与预期相差在容差内。expected 的时刻已经换算成事件的 monoUs。
 */
function analyzeCursorMove(events, { aUs, bUs, holdUs, direction, earlyUs = 80_000, lateUs = 300_000 }) {
  const cursor = events.filter(event => event.kind === 'cursor' && Array.isArray(event.point))
  const pointIn = (from, to) => cursor.filter(event => event.monoUs >= from && event.monoUs < to).at(-1)?.point ?? null
  // B 段只看停留时间的前八成：之后脚本会把光标放回原处。
  const atA = pointIn(aUs - earlyUs, bUs - earlyUs), atB = pointIn(bUs - earlyUs, bUs + holdUs * 0.8)
  if (!atA || !atB) return { ok: false, reason: '移动前后没有光标事件', atA, atB }
  const dx = atB[0] - atA[0], dy = atB[1] - atA[1]
  const sameDirection = Math.sign(dx) === Math.sign(direction[0]) && Math.sign(dy) === Math.sign(direction[1])
  const arrival = cursor.find(event => event.monoUs >= bUs - earlyUs && Math.hypot(event.point[0] - atB[0], event.point[1] - atB[1]) <= 2)
  const delayMs = arrival ? Math.round((arrival.monoUs - bUs) / 1000) : null
  const timely = delayMs !== null && delayMs * 1000 >= -earlyUs && delayMs * 1000 <= lateUs
  return { ok: sameDirection && timely, sameDirection, delayMs, atA, atB, reason: !sameDirection ? '位置变化方向与实际移动不一致' : timely ? undefined : '事件时刻与实际移动相差过大' }
}

/** 结束后录制里不该出现的日志事件；出现即判有问题。 */
const FORBIDDEN_EVENTS = {
  audio: ['audio_capture.recording.failed', 'audio_edit.splice.failed', 'audio_capture.owner.failed'],
  screen: ['recording.capture.failed', 'recording.capture.finish.failed', 'recording.events.backlog', 'recording.events.capture.failed', 'recording.tracks.journal.failed',
    'recording.audio.join.failed', 'recording.document.save.failed', 'recording.session.events.failed', 'audio_capture.recording.failed', 'audio_capture.system_audio.failed'],
}

function summarizeLogs(events) {
  const byEvent = {}
  for (const event of events) {
    const key = `${event.level} ${event.event}`
    byEvent[key] = (byEvent[key] ?? 0) + 1
  }
  return Object.entries(byEvent).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
}

const near = (actual, expected, tolerance) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance
const durationTolerance = seconds => 3 + seconds * 0.001

/** 汇总所有核对项，给出“通过 / 有问题”。problems 判失败，notes 只提示。 */
function evaluateSoak(result) {
  const problems = [], notes = []
  const wall = result.recording?.wallSeconds
  if (result.fatal) problems.push(`脚本中途失败：${result.fatal}`)
  if (!result.recording?.startedAtMs) problems.push('录制没有开始')
  for (const step of result.steps ?? []) {
    if (step.skipped) { notes.push(`${step.action} 已跳过：${step.skipped}`); continue }
    if (!step.ok) problems.push(`${step.action}（第 ${Math.round(step.scheduledSec)} 秒）失败：${step.error ?? step.details?.reason ?? '未知原因'}`)
    if (step.details?.before && step.details.before.alive === false) problems.push(`${step.action} 之前录制已不在进行（${step.details.before.reason ?? ''}）`)
    if (step.details?.after && step.details.after.alive === false && step.action !== 'stop') problems.push(`${step.action} 之后录制不在进行（${step.details.after.reason ?? ''}）`)
    for (const note of step.details?.notes ?? []) notes.push(`${step.action}：${note}`)
  }
  const deadBeats = (result.heartbeats ?? []).filter(beat => beat.alive === false)
  if (deadBeats.length) problems.push(`存活检查有 ${deadBeats.length} 次显示录制不在进行（首次在 ${new Date(deadBeats[0].atMs).toISOString()}）`)
  const stalled = (result.heartbeats ?? []).filter(beat => beat.stalled)
  if (stalled.length) problems.push(`存活检查有 ${stalled.length} 次时长没有前进`)

  const power = result.power ?? {}
  if (power.during?.available === false || power.after?.available === false) notes.push(`powercfg /requests 未取证：${power.during?.error ?? power.after?.error ?? '需要管理员权限'}；可用管理员终端重跑`)
  else {
    if (power.during && !power.during.hits?.length) problems.push('录制期间 powercfg /requests 里没有本应用的防睡眠请求')
    if (power.after && power.after.hits?.length) problems.push('录制结束后 powercfg /requests 里仍有本应用的请求')
  }
  const powerLogs = result.logs?.events?.filter(event => event.event?.startsWith('recording_power.')) ?? []
  if (!powerLogs.some(event => event.event === 'recording_power.hold.start')) problems.push('日志里没有 recording_power.hold.start')
  if (result.recording?.stoppedAtMs && !powerLogs.some(event => event.event === 'recording_power.hold.completed')) problems.push('停止后日志里没有 recording_power.hold.completed')

  // 与录制相关的错误判失败；别的子系统的错误只列出来，免得一小时里无关的报错掩盖结论。
  for (const event of result.logs?.errors ?? []) {
    const related = /audio_capture|recording|audio_edit|capture|power/i.test(`${event.domain} ${event.event}`)
    ;(related ? problems : notes).push(`${related ? '' : '其他'}错误日志 ${event.event}：${event.message}`)
  }
  const forbidden = FORBIDDEN_EVENTS[result.scenario] ?? []
  for (const event of [...result.logs?.warnings ?? [], ...result.logs?.events ?? []]) if (forbidden.includes(event.event)) problems.push(`出现 ${event.event}：${event.message}`)
  if (result.logs?.warnings?.length) notes.push(`期间警告 ${result.logs.warnings.length} 条（见 logs.warnings）`)

  const trend = memoryTrend(result.memory ?? [])
  if (trend.growing.length) problems.push(`内存疑似持续增长：${trend.growing.join('、')}`)
  if ((result.memory ?? []).length < 3) notes.push('内存样本不足三次，增长判断不可靠')

  if (result.scenario === 'audio') evaluateAudio(result, wall, problems, notes)
  else evaluateScreen(result, wall, problems, notes)
  for (const missing of result.missingInterfaces ?? []) notes.push(`需要补的接口：${missing}`)
  // 录静止画面说明不了问题：没有运动源，或运动源中途停了，结论是“未达测试条件”，不算通过。
  const unmet = []
  if (result.options?.motion) {
    const motion = result.motion
    if (!motion?.ok) unmet.push(`未能提供运动画面：${motion?.reason ?? '没有启动'}`)
    else if (motion.exitedAtMs && (!result.recording?.stopRequestedAtMs || motion.exitedAtMs < result.recording.stopRequestedAtMs)) unmet.push(`运动源在录制结束前退出（退出码 ${motion.exitCode ?? '—'}）`)
  }
  return { passed: problems.length === 0 && unmet.length === 0, conditionMet: unmet.length === 0, unmetConditions: unmet, problems: [...new Set(problems)], notes: [...new Set(notes)], memoryTrend: trend }
}

function evaluateAudio(result, wall, problems, notes) {
  const summary = result.checks?.summary
  if (!summary) { problems.push('没有找到 audio_capture.recording.summary'); return }
  if (summary.outcome !== 'completed') problems.push(`录音结束结果是 ${summary.outcome}${summary.code ? `（${summary.code}）` : ''}`)
  if (Number.isFinite(wall) && !near(summary.durationSeconds, wall, durationTolerance(wall))) problems.push(`录音时长 ${summary.durationSeconds} 秒与墙钟 ${wall.toFixed(1)} 秒相差过大`)
  if (summary.droppedFrames > 0) problems.push(`写盘跟不上丢了 ${summary.droppedFrames} 帧（已补静音）`)
  if (summary.inputOverflows > 0 || summary.inputUnderflows > 0) notes.push(`驱动溢出 ${summary.inputOverflows} 次、欠载 ${summary.inputUnderflows} 次（只计数，不中断）`)
  if (summary.droppedPreviewBlocks > 0 || summary.previewDroppedBlocks > 0) notes.push(`波形推送丢弃：原生 ${summary.droppedPreviewBlocks ?? 0} 块、主进程 ${summary.previewDroppedBlocks ?? 0} 块（不影响文件）`)
  if (summary.maxWriteMs >= 500) notes.push(`写盘最长 ${summary.maxWriteMs} ms`)
  const take = result.checks?.take
  if (!take?.spliced) problems.push(`录音没有拼回作品：${take?.reason ?? '超时'}`)
  else if (!near(take.insertedSeconds, summary.durationSeconds, 1.5)) problems.push(`拼回作品的长度 ${take.insertedSeconds?.toFixed(2)} 秒与录音时长 ${summary.durationSeconds} 秒不符`)
  for (const file of result.checks?.files ?? []) {
    if (!file.probe?.ok) { if (file.required) problems.push(`读不出 ${file.role}：${file.path}（${file.probe?.error ?? '不存在'}）`); else notes.push(`${file.role} 没有留下：${file.path}`); continue }
    if (file.role === '原始录音' && !near(file.probe.durationSeconds, summary.durationSeconds, 1)) problems.push(`原始录音文件时长 ${file.probe.durationSeconds} 秒与汇总 ${summary.durationSeconds} 秒不符`)
  }
  checkReload(result, ['audio_capture.owner.detached', 'audio_capture.owner.attached', 'audio_capture.session.attach.completed'], problems)
}

function evaluateScreen(result, wall, problems, notes) {
  const summary = result.checks?.summary
  if (!summary) { problems.push('没有找到 recording.capture.summary'); return }
  if (summary.failed) problems.push('录制按失败收尾')
  if (summary.status && summary.status !== 'stopped') problems.push(`录制结束状态是 ${summary.status}`)
  const durationSeconds = Number.isFinite(summary.durationUs) ? summary.durationUs / 1e6 : null
  if (Number.isFinite(wall) && !near(durationSeconds, wall, durationTolerance(wall))) problems.push(`录制时长 ${durationSeconds?.toFixed(1)} 秒与墙钟 ${wall.toFixed(1)} 秒相差过大`)
  const restarts = result.checks?.expectedEncoderRestarts ?? 0
  if ((summary.encoderRestarts ?? 0) !== restarts) problems.push(`编码续录 ${summary.encoderRestarts ?? 0} 次，预期 ${restarts} 次`)
  if (summary.rejectedSpans > 0) problems.push(`有 ${summary.rejectedSpans} 个画面分片被弃用`)
  const frames = result.checks?.expectedFrames
  if (frames && summary.droppedFrames > frames * 0.005) problems.push(`丢帧 ${summary.droppedFrames}（预期总帧数约 ${frames}）`)
  else if (summary.droppedFrames > 0) notes.push(`丢帧 ${summary.droppedFrames}`)
  if (frames && summary.duplicatedFrames > frames * 0.05) notes.push(`重复帧 ${summary.duplicatedFrames}，约占 ${(summary.duplicatedFrames / frames * 100).toFixed(1)}%（画面静止时编码器会补重复帧）`)
  // 事件页按有事件的时段封页，长时间不动鼠标时会少，只作提示。
  if (Number.isFinite(durationSeconds) && summary.eventPages < durationSeconds / 4) notes.push(`事件页 ${summary.eventPages} 页（持续动鼠标时约每 2 秒一页）`)
  const gaps = result.checks?.gaps ?? []
  for (const [kind, count] of Object.entries(result.checks?.audioFiles ?? {})) {
    if (count === 1) continue
    // 麦克风仍由界面写，界面重载留下、副本补不回来的缺数据空档属已知限制；系统声由原生进程录，必须是一条。
    const missing = gaps.filter(gap => gap.kind === kind && gap.reason === 'missing-data').length
    if (kind === 'microphone' && missing && count === missing + 1) notes.push(`${kind} 在 ${missing} 处缺数据空档分成了 ${count} 条`)
    else problems.push(`${kind} 拼成了 ${count} 条声音（预期每路一条）`)
  }
  for (const kind of result.checks?.expectedAudioKinds ?? []) if (!(kind in (result.checks?.audioFiles ?? {}))) problems.push(`没有 ${kind} 声音`)
  for (const file of result.checks?.files ?? []) if (!file.probe?.ok) problems.push(`读不出 ${file.role}：${file.path}（${file.probe?.error ?? '不存在'}）`)
  if (result.checks?.leftoverNativeCopies?.length) problems.push(`录制目录残留 ${result.checks.leftoverNativeCopies.length} 个麦克风副本`)
  for (const gap of gaps) if (gap.reason !== 'pause' && gap.reason !== 'missing-data') problems.push(`${gap.kind} 有 ${gap.reason} 空档 ${(gap.durationUs / 1e6).toFixed(2)} 秒`)
  const systemMissing = gaps.filter(gap => gap.kind === 'systemAudio' && gap.reason === 'missing-data')
  if (systemMissing.length) problems.push(`系统声有 ${systemMissing.length} 段缺数据空档，共 ${(systemMissing.reduce((sum, gap) => sum + gap.durationUs, 0) / 1e6).toFixed(2)} 秒（系统声由原生进程录，界面重载不应留空档）`)
  const micMissing = gaps.filter(gap => gap.kind === 'microphone' && gap.reason === 'missing-data')
  if (micMissing.length) notes.push(`麦克风缺数据空档 ${micMissing.length} 段，共 ${(micMissing.reduce((sum, gap) => sum + gap.durationUs, 0) / 1e6).toFixed(2)} 秒（界面重载期间麦克风轨由界面写，属已知限制）`)
  evaluateSystemAudio(result, durationSeconds, problems, notes)
  for (const check of result.checks?.cursor ?? []) if (!check.ok) problems.push(`光标对齐抽查失败（第 ${Math.round(check.scheduledSec)} 秒）：${check.reason}`)
  for (const check of result.checks?.picture ?? []) if (!check.changed) notes.push(`切工作区后 ${check.windowSeconds} 秒内画面没有可见变化（被录来源可能没有显示应用窗口）`)
  const motionPicture = result.checks?.motionPicture
  if (motionPicture && !motionPicture.changed) problems.push(`运动源在跑，但录到的画面${motionPicture.error ? `读不出（${motionPicture.error}）` : '在抽查的几秒内没有变化'}`)
  checkReload(result, ['recording.host.detached', 'recording.host.attached', 'recording.session.attach.completed'], problems)
}

/**
 * 系统声由原生录音进程按时间轴录：结束汇总要在、时长等于录制时长（无声时补静音），
 * 不应重连或写盘失败；运动源出声时文件里要有信号，界面重载那几秒也不能是静音。
 */
function evaluateSystemAudio(result, recordingSeconds, problems, notes) {
  if (!result.checks?.expectedAudioKinds?.includes('systemAudio')) return
  const system = result.checks.systemAudio ?? {}
  const summary = system.summary
  if (!summary) { problems.push('没有找到 audio_capture.system_audio.summary'); return }
  if (summary.outcome && summary.outcome !== 'completed') problems.push(`系统声结束结果是 ${summary.outcome}`)
  if (Number.isFinite(recordingSeconds) && !near(summary.durationSeconds, recordingSeconds, durationTolerance(recordingSeconds))) problems.push(`系统声时长 ${summary.durationSeconds} 秒与录制时长 ${recordingSeconds.toFixed(1)} 秒不符（无声时应按时间轴补静音）`)
  if (summary.droppedFrames > 0) problems.push(`系统声写盘跟不上丢了 ${summary.droppedFrames} 帧（已补静音）`)
  if (summary.reconnects > 0) problems.push(`系统声原生服务失联重连 ${summary.reconnects} 次`)
  if (summary.discontinuities > 0) notes.push(`系统声数据不连续 ${summary.discontinuities} 次（已按时间戳补齐）`)
  if (summary.deviceSwitches > 0) notes.push(`系统声输出设备切换 ${summary.deviceSwitches} 次`)
  if (summary.unavailableSeconds > 0) notes.push(`系统声输出设备不可用共 ${summary.unavailableSeconds} 秒（文件里是静音）`)
  notes.push(`系统声补静音 ${summary.silenceSeconds ?? '—'} 秒、写盘峰值 ${summary.maxWriteMs ?? '—'} ms`)
  for (const name of ['audio_capture.system_audio.failed', 'audio_capture.system_audio.reconnect.start', 'audio_capture.system_audio.start.failed', 'audio_capture.system_audio.stop.failed']) {
    if (system.eventCounts?.[name]) problems.push(`出现 ${name} ×${system.eventCounts[name]}`)
  }
  const file = system.file
  if (file && Number.isFinite(recordingSeconds) && !near(file.durationSeconds, recordingSeconds, durationTolerance(recordingSeconds))) problems.push(`拼好的系统声文件 ${file.durationSeconds?.toFixed(1)} 秒，与录制时长 ${recordingSeconds.toFixed(1)} 秒不符`)
  if (result.motion?.ok && result.motion.audio) {
    if (!system.level) problems.push('没能测量系统声电平')
    else if (!(system.level.maxVolumeDb > -60)) problems.push(`运动源在出声，录到的系统声却几乎没有信号（峰值 ${system.level.maxVolumeDb ?? '—'} dB）`)
    for (const window of system.reloadWindows ?? []) {
      if (window.error) notes.push(`界面重载处系统声电平没测成：${window.error}`)
      else if (window.silences.length) problems.push(`界面重载（第 ${Math.round(window.scheduledSec)} 秒）前后系统声有 ${window.silences.map(item => `${(item.durationSeconds ?? 0).toFixed(2)} 秒`).join('、')}的静音`)
    }
  }
}

/** 每次界面重载或崩溃之后，日志里应依次出现断开、接回、接管完成。 */
function checkReload(result, sequence, problems) {
  const events = result.logs?.events ?? []
  for (const step of result.steps ?? []) {
    if (!['reload', 'crash-renderer'].includes(step.action) || step.skipped || !step.startedAtMs) continue
    let cursor = step.startedAtMs - 1000
    for (const name of sequence) {
      const hit = events.find(event => event.event === name && Date.parse(event.timestamp) >= cursor)
      if (!hit) { problems.push(`${step.action}（第 ${Math.round(step.scheduledSec)} 秒）后日志里没有 ${name}`); break }
      cursor = Date.parse(hit.timestamp)
    }
  }
}

const mb = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : '—'
const seconds = value => Number.isFinite(value) ? `${value.toFixed(1)} 秒` : '—'

function renderSoakMarkdown(result) {
  const verdict = result.verdict ?? evaluateSoak(result)
  const lines = []
  const name = result.scenario === 'audio' ? '录音' : '录屏'
  lines.push(`# 长录结果：${name} ${result.options?.minutes ?? ''} 分钟`, '')
  lines.push(`**结论：${verdict.conditionMet === false ? '未达测试条件' : verdict.passed ? '通过' : '有问题'}**`, '')
  if (verdict.unmetConditions?.length) { lines.push('## 未达测试条件', ''); for (const item of verdict.unmetConditions) lines.push(`- ${item}`); lines.push('') }
  if (verdict.problems.length) { lines.push('## 问题', ''); for (const item of verdict.problems) lines.push(`- ${item}`); lines.push('') }
  if (verdict.notes.length) { lines.push('## 提示', ''); for (const item of verdict.notes) lines.push(`- ${item}`); lines.push('') }
  lines.push('## 概况', '')
  lines.push(`- 开始：${result.recording?.startedAtMs ? new Date(result.recording.startedAtMs).toISOString() : '—'}；停止：${result.recording?.stoppedAtMs ? new Date(result.recording.stoppedAtMs).toISOString() : '—'}`)
  const summary = result.checks?.summary
  const recorded = result.scenario === 'audio' ? summary?.durationSeconds : Number.isFinite(summary?.durationUs) ? summary.durationUs / 1e6 : undefined
  const wall = result.recording?.wallSeconds
  lines.push(`- 墙钟时长：${seconds(wall)}；录到的时长：${seconds(recorded)}；差：${Number.isFinite(recorded) && Number.isFinite(wall) ? `${(recorded - wall).toFixed(2)} 秒` : '—'}`)
  if (result.scenario === 'audio' && summary) {
    lines.push(`- 录音汇总：时长 ${summary.durationSeconds} 秒、经过 ${summary.elapsedSeconds} 秒、溢出 ${summary.inputOverflows}、欠载 ${summary.inputUnderflows}、丢帧补静音 ${summary.droppedFrames}、丢推送 ${summary.droppedPreviewBlocks}/${summary.previewDroppedBlocks}、写盘峰值 ${summary.maxWriteMs} ms`)
    if (result.checks?.take) lines.push(`- 拼回作品：${result.checks.take.spliced ? `插入 ${seconds(result.checks.take.insertedSeconds)}` : `未完成（${result.checks.take.reason ?? ''}）`}`)
  }
  if (result.scenario === 'screen' && summary) {
    lines.push(`- 录制汇总：时长 ${seconds(summary.durationUs / 1e6)}、画面分片 ${summary.screenSpans}（补齐 ${summary.repairedSpans}、弃用 ${summary.rejectedSpans}）、丢帧 ${summary.droppedFrames ?? '—'}、重复帧 ${summary.duplicatedFrames ?? '—'}、续录 ${summary.encoderRestarts ?? '—'}、编码器 ${summary.encoder ?? '—'}`)
    lines.push(`- 事件：${summary.eventPages} 页、${summary.events} 条；单页写盘最长 ${summary.maxPageWriteMs} ms；轨道记录最长 ${summary.maxTrackWriteMs} ms；界面断开 ${summary.detaches} 次`)
    lines.push(`- 声音：${Object.entries(result.checks?.audioFiles ?? {}).map(([kind, count]) => `${kind} ${count} 条`).join('、') || '无'}`)
    const system = result.checks?.systemAudio
    if (system?.summary) lines.push(`- 系统声：时长 ${system.summary.durationSeconds} 秒、${system.summary.segments} 段、补静音 ${system.summary.silenceSeconds} 秒、设备不可用 ${system.summary.unavailableSeconds} 秒、丢帧 ${system.summary.droppedFrames}、不连续 ${system.summary.discontinuities}、设备切换 ${system.summary.deviceSwitches}、重连 ${system.summary.reconnects}；电平峰值 ${system.level?.maxVolumeDb ?? '—'} dB、平均 ${system.level?.meanVolumeDb ?? '—'} dB`)
    const motion = result.motion
    const early = motion?.exitedAtMs && !(motion.exitedAtMs >= result.recording?.stopRequestedAtMs)
    if (motion) lines.push(`- 运动源：${motion.ok ? `${motion.source}${motion.audio ? '（带测试音）' : ''}，${early ? `${new Date(motion.exitedAtMs).toISOString()} 提前退出` : '全程在跑'}` : `未能提供（${motion.reason}）`}`)
  }
  for (const file of result.checks?.files ?? []) lines.push(`- ${file.role}：${file.path}（${file.probe?.ok ? `${seconds(file.probe.durationSeconds)}${file.probe.sampleRate ? `、${file.probe.sampleRate} Hz` : ''}${file.probe.channels ? `、${file.probe.channels} 声道` : ''}` : file.probe?.error ?? '不存在'}）`)
  lines.push('', '## 施压步骤', '', '| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |', '|---|---|---|---|---|---|')
  const alive = state => state ? (state.alive ? `在录 ${seconds(state.durationSeconds)}` : `不在录${state.reason ? `：${state.reason}` : ''}`) : '—'
  for (const step of result.steps ?? []) lines.push(`| ${Math.round(step.scheduledSec)} 秒 | ${step.action} | ${step.lateMs ?? 0} ms | ${step.skipped ? `跳过：${step.skipped}` : step.ok ? '成功' : `失败：${String(step.error ?? step.details?.reason ?? '').split('\n')[0].slice(0, 120)}`} | ${alive(step.details?.before)} | ${alive(step.details?.after)} |`)
  lines.push('', '## 内存（私有字节合计）', '')
  for (const sample of result.memory ?? []) lines.push(`- ${sample.label} ${new Date(sample.atMs).toISOString().slice(11, 19)}：${mb(sample.totalPrivateBytes)}（${Object.entries(sample.categories).map(([key, value]) => `${key} ${mb(value.privateBytes)}`).join('、')}）`)
  lines.push('', '## 防睡眠', '')
  lines.push(`- 录制期间：${result.power?.during ? (result.power.during.available === false ? `未取证（${result.power.during.error}）` : result.power.during.hits?.map(hit => `${hit.section} ${hit.line}`).join('；') || '没有本应用的请求') : '—'}`)
  lines.push(`- 结束之后：${result.power?.after ? (result.power.after.available === false ? `未取证（${result.power.after.error}）` : result.power.after.hits?.map(hit => `${hit.section} ${hit.line}`).join('；') || '没有本应用的请求') : '—'}`)
  lines.push('', '## 日志', '')
  lines.push(`- 警告/错误按事件计数：${(result.logs?.summary ?? []).map(item => `${item.key} ×${item.count}`).join('；') || '无'}`)
  lines.push('', '## 产物', '')
  for (const entry of result.storage?.paths ?? []) lines.push(`- ${entry.path}：${mb(entry.bytes)}`)
  lines.push(`- 合计：${mb(result.storage?.totalBytes)}（脚本不删除，核对后手动清理）`)
  if (result.missingInterfaces?.length) { lines.push('', '## 需要补的接口', ''); for (const item of result.missingInterfaces) lines.push(`- ${item}`) }
  lines.push('')
  return lines.join('\n')
}

/** 跨越的 UTC 日期（日志文件按 UTC 日期分）。 */
function utcDatesBetween(fromMs, toMs) {
  const dates = []
  const day = 86_400_000
  for (let at = Math.floor(fromMs / day) * day; at <= toMs; at += day) dates.push(new Date(at).toISOString().slice(0, 10))
  return dates
}

/** 0.5 秒静音的 16 位单声道 WAV：给音频编辑作品一个已有素材，录音拼在它前面。 */
function silentWav(sampleRate = 48000, seconds = 0.5) {
  const frames = Math.round(sampleRate * seconds), dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

function timestampName(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

module.exports = {
  analyzeCursorMove, descendants, evaluateSoak, FORBIDDEN_EVENTS, loadSecondsFor, memorySample, memoryTrend, parsePowercfgRequests, parseSoakArgs, periodicIntervals,
  planSchedule, powerRequestsFor, processCategory, readEventsBetween, renderSoakMarkdown, runSchedule, silentWav, summarizeLogs, timestampName, utcDatesBetween,
}
