import type { CaptureEvent } from '../captureLog/events'
import { audioEditFillerConfidence } from '../audioEdit/analysis'
import { emptyRecordingUnderstanding, recordingUnderstandingSchema, type RecordingUnderstanding, type RecordingRange, type RecordingTranscript } from './understanding'

export function mergeRecordingRanges(ranges: readonly RecordingRange[]): RecordingRange[] {
  const result: RecordingRange[] = []
  for (const range of [...ranges].sort((a, b) => a.startUs - b.startUs)) {
    if (range.endUs <= range.startUs) continue
    const last = result.at(-1)
    if (last && range.startUs <= last.endUs) last.endUs = Math.max(last.endUs, range.endUs)
    else result.push({ ...range })
  }
  return result
}
export function intersectRecordingRanges(a: readonly RecordingRange[], b: readonly RecordingRange[]): RecordingRange[] {
  const left = mergeRecordingRanges(a), right = mergeRecordingRanges(b), result: RecordingRange[] = []
  let i = 0, j = 0
  while (i < left.length && j < right.length) {
    const startUs = Math.max(left[i].startUs, right[j].startUs), endUs = Math.min(left[i].endUs, right[j].endUs)
    if (endUs > startUs) result.push({ startUs, endUs })
    if (left[i].endUs < right[j].endUs) i++; else j++
  }
  return result
}
export function subtractRecordingRanges(ranges: readonly RecordingRange[], excluded: readonly RecordingRange[]): RecordingRange[] {
  const cuts = mergeRecordingRanges(excluded), result: RecordingRange[] = []
  let index = 0
  for (const range of mergeRecordingRanges(ranges)) {
    let startUs = range.startUs
    while (index < cuts.length && cuts[index].endUs <= startUs) index++
    for (let i = index; i < cuts.length && cuts[i].startUs < range.endUs; i++) {
      if (cuts[i].startUs > startUs) result.push({ startUs, endUs: cuts[i].startUs })
      startUs = Math.max(startUs, cuts[i].endUs)
    }
    if (startUs < range.endUs) result.push({ startUs, endUs: range.endUs })
  }
  return result
}
export interface RecordingAnalysisInput {
  active: RecordingRange[]
  events: CaptureEvent[]
  transcript: RecordingTranscript[]
  /** Measured evidence only. Empty means unknown/no silence, never ASR timestamp gaps. */
  silence: RecordingRange[]
  stillness: RecordingRange[]
  sceneCutsUs: number[]
  warnings?: string[]
}
type Boundary = { time: number; priority: number; signal: RecordingUnderstanding['steps'][number]['signal']; title: string; eventIds: string[] }
/** No pixel work here: media evidence is decoded by the existing FFmpeg subprocess. */
export function segmentRecording(input: RecordingAnalysisInput): RecordingUnderstanding {
  const result = emptyRecordingUnderstanding()
  const events = [...input.events].sort((a, b) => a.monoUs - b.monoUs || a.seq - b.seq)
  const pauses: RecordingRange[] = []; let paused: number | undefined
  const inputCoverage: RecordingRange[] = []; let collecting: number | undefined
  for (const event of events) if (event.kind === 'control') {
    if (['start', 'resume'].includes(event.action)) collecting = event.monoUs
    else if (collecting !== undefined) { inputCoverage.push({ startUs: collecting, endUs: event.monoUs }); collecting = undefined }
    if (event.action === 'pause') paused = event.monoUs
    else if (paused !== undefined && ['resume', 'stop'].includes(event.action)) { pauses.push({ startUs: paused, endUs: event.monoUs }); paused = undefined }
  }
  if (paused !== undefined) pauses.push({ startUs: paused, endUs: Number.MAX_SAFE_INTEGER })
  const active = subtractRecordingRanges(input.active, pauses)
  result.transcript = input.transcript.filter(word => active.some(r => word.startUs >= r.startUs && word.endUs <= r.endUs)).sort((a, b) => a.startUs - b.startUs)
  result.warnings = [...new Set(input.warnings ?? [])]
  const boundaries: Boundary[] = []
  const activity: RecordingRange[] = []
  const clicks: Extract<CaptureEvent, { kind: 'click' }>[] = []
  const candidateIds = new Set<string>()
  let previousClick = -Infinity, previousWindow: string | null = null
  const candidate = (range: RecordingRange, kind: RecordingUnderstanding['candidates'][number]['kind'], reason: string, eventIds: string[] = []): void => {
    for (const clipped of intersectRecordingRanges([range], active)) {
      const id = `${kind}:${clipped.startUs}:${clipped.endUs}:${eventIds.join(':')}`
      // Overlapping microphone/system tracks can describe the same candidate interval.
      if (candidateIds.has(id)) continue
      candidateIds.add(id)
      result.candidates.push({ id, ...clipped, kind, reason, status: 'pending', eventIds })
    }
  }
  for (const event of events) {
    const at = event.monoUs
    if (event.kind === 'control') { previousClick = -Infinity; previousWindow = null; clicks.length = 0; continue }
    if (!active.some(r => at >= r.startUs && at < r.endUs)) continue
    if (['click', 'key', 'scroll', 'capability', 'mark'].includes(event.kind)) activity.push({ startUs: Math.max(0, at - 500000), endUs: at + 1000000 })
    if (event.kind === 'capability') {
      if (event.phase === 'started') boundaries.push({ time: at, priority: 5, signal: 'capability', title: '执行操作', eventIds: [event.eventId] })
      if (event.phase === 'failed') candidate({ startUs: Math.max(0, at - 1000000), endUs: at + 1000000 }, 'mistake', '操作返回失败，请检查是否保留这一段', [event.eventId])
    } else if (event.kind === 'window' && event.available && event.windowId) {
      // 开录后第一次看到的窗口只是起点，不算切换（否则每次录制开头都多一个“切换窗口”步骤）。
      if (previousWindow !== null && event.windowId !== previousWindow) boundaries.push({ time: at, priority: 4, signal: 'window', title: '切换窗口', eventIds: [event.eventId] })
      previousWindow = event.windowId
    } else if (event.kind === 'click' && event.phase === 'down') {
      if (at - previousClick > 1200000) boundaries.push({ time: at, priority: 3, signal: 'click', title: '点击操作', eventIds: [event.eventId] })
      previousClick = at; clicks.push(event); if (clicks.length > 3) clicks.shift()
      const [a, b, c] = clicks
      if (c && c.monoUs - a.monoUs <= 2000000 && Math.hypot(c.point[0] - a.point[0], c.point[1] - a.point[1]) < 12 && Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1]) > 40) candidate({ startUs: a.monoUs, endUs: c.monoUs + 300000 }, 'mistake', '短时间往返点击，可能是操作回退', clicks.map(v => v.eventId))
    } else if (event.kind === 'key' && ['undo', 'cancel'].includes(event.category)) candidate({ startUs: Math.max(0, at - 1500000), endUs: at + 500000 }, 'mistake', '撤销或取消操作，请检查前一段', [event.eventId])
    else if (event.kind === 'mark') boundaries.push({ time: at, priority: 6, signal: 'marker', title: event.note?.trim().slice(0, 120) || '重点步骤', eventIds: [event.eventId] })
  }
  for (const time of input.sceneCutsUs) boundaries.push({ time, priority: 2, signal: 'scene', title: '画面变化', eventIds: [] })
  // Speech is secondary: sentence starts can split long quiet operations; a continuous sentence
  // merges nearby weak visual/click candidates, but never overrides capabilities or window changes.
  for (let i = 0; i < result.transcript.length; i++) {
    const word = result.transcript[i], prev = result.transcript[i - 1]
    if (!audioEditFillerConfidence(word.text) && (!prev || word.startUs - prev.endUs >= 1500000 || /[。！？.!?]$/u.test(prev.text))) boundaries.push({ time: word.startUs, priority: 1, signal: 'speech', title: word.text.trim().slice(0, 120) || '讲解', eventIds: [] })
    if (!word.protected && word.granularity === 'word' && audioEditFillerConfidence(word.text)) candidate(word, 'filler', `语气词“${word.text.slice(0, 30)}”，请结合上下文决定`)
  }
  const sorted = boundaries.sort((a, b) => a.time - b.time || b.priority - a.priority)
  const phrases: RecordingRange[] = []
  for (let i = 0; i < result.transcript.length; i++) {
    const word = result.transcript[i], previous = result.transcript[i - 1], last = phrases.at(-1)
    if (last && previous && word.startUs - previous.endUs < 1500000 && !/[。！？.!?]$/u.test(previous.text)) last.endUs = Math.max(last.endUs, word.endUs)
    else phrases.push({ startUs: word.startUs, endUs: word.endUs })
  }
  let boundaryIndex = 0, wordIndex = 0, phraseIndex = 0
  for (const span of active) {
    const selected: Boundary[] = [{ time: span.startUs, priority: 0, signal: 'start', title: '录制步骤', eventIds: [] }]
    while (boundaryIndex < sorted.length && sorted[boundaryIndex].time < span.startUs) boundaryIndex++
    while (boundaryIndex < sorted.length && sorted[boundaryIndex].time < span.endUs) {
      const boundary = sorted[boundaryIndex++], last = selected.at(-1)!
      while (phraseIndex < phrases.length && phrases[phraseIndex].endUs <= boundary.time) phraseIndex++
      const phrase = phrases[phraseIndex]
      if (boundary.priority <= 3 && phrase && phrase.startUs < boundary.time && phrase.endUs > boundary.time) continue
      if (boundary.time - last.time < 1500000) {
        if (boundary.priority > last.priority) selected[selected.length - 1] = { ...boundary, time: last.time === span.startUs ? span.startUs : boundary.time }
      } else if (span.endUs - boundary.time >= 700000) selected.push(boundary)
    }
    selected.forEach((boundary, i) => {
      const endUs = selected[i + 1]?.time ?? span.endUs
      while (wordIndex < result.transcript.length && result.transcript[wordIndex].endUs <= boundary.time) wordIndex++
      const words: string[] = []
      for (let j = wordIndex; j < result.transcript.length && result.transcript[j].startUs < endUs; j++) words.push(result.transcript[j].text)
      const speech = words.join(' ').trim()
      result.steps.push({ id: `step:${boundary.time}`, startUs: boundary.time, endUs, title: boundary.signal === 'marker' ? boundary.title : speech.slice(0, 60) || boundary.title, description: speech.slice(0, 4000) || boundary.title, signal: boundary.signal, eventIds: boundary.eventIds })
    })
  }
  const silent = intersectRecordingRanges(subtractRecordingRanges(input.silence, result.transcript), active)
  for (const range of silent) if (range.endUs - range.startUs >= 1500000) candidate(range, 'pause', '本地声音能量检测到停顿')
  const waits = intersectRecordingRanges(intersectRecordingRanges(subtractRecordingRanges(input.stillness, activity), silent), inputCoverage)
  for (const range of waits) if (range.endUs - range.startUs >= 2000000) candidate(range, 'wait', '画面基本静止、没有输入且没有旁白，可考虑加速')
  let chapterStart = -Infinity
  for (const step of result.steps) {
    if (!result.chapters.length || ['window', 'marker'].includes(step.signal) || step.startUs - chapterStart >= 60000000) {
      result.chapters.push({ id: `chapter:${step.startUs}`, title: step.title, stepIds: [] }); chapterStart = step.startUs
    }
    result.chapters.at(-1)!.stepIds.push(step.id)
  }
  result.candidates.sort((a, b) => a.startUs - b.startUs || a.kind.localeCompare(b.kind))
  return recordingUnderstandingSchema.parse(result)
}
