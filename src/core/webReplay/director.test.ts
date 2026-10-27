import { describe, expect, it } from 'vitest'
import { parseWebReplayDirector, WebReplayDirectorError, checkDirectorAgainstRecording } from './director'
import { DirectorTimeline } from './directorTimeline'
import { CUT_STEP_US, planWebReplay, typewriterSchedule, type PlanOp } from './directorPlan'
import type { WebRecordingBehaviorEvent } from './schema'

const S = 1_000_000
const move = (t: number, x: number, y: number): WebRecordingBehaviorEvent => ({ kind: 'pointer', t, type: 'move', x, y, button: -1, buttons: 0, clickCount: 0, pointerType: 'mouse', mods: 0 })
const press = (t: number, type: 'down' | 'up', x: number, y: number): WebRecordingBehaviorEvent => ({ kind: 'pointer', t, type, x, y, button: 0, buttons: type === 'down' ? 1 : 0, clickCount: 1, pointerType: 'mouse', mods: 0 })
const viewport = { width: 1280, height: 800 }

function issues(value: unknown): string[] {
  try { parseWebReplayDirector(value) } catch (error) { if (error instanceof WebReplayDirectorError) return error.issues; throw error }
  return []
}

describe('导演稿格式', () => {
  it('补默认值', () => {
    const script = parseWebReplayDirector({ version: 1, timeline: { segments: [{ from: 0, to: 5 }] }, typewriter: [{ at: 3 }], actions: [{ kind: 'click', at: 4, target: { selector: '.go' } }] })
    expect(script.timeline).toEqual({ segments: [{ from: 0, to: 5, speed: 1 }], ramp: 0 })
    expect(script.typewriter).toEqual([{ at: 3, charsPerSecond: 12, jitter: 0.3 }])
    expect(script.actions![0]).toMatchObject({ kind: 'click', button: 'left', approach: 0.35 })
  })

  it('校验失败逐条点名字段', () => {
    expect(issues({ version: 1, timeline: { segments: [{ from: 0, to: 5 }, { from: 4, to: 3 }] } })).toEqual([
      'timeline.segments[1].to：要大于 from（4）',
      'timeline.segments[1].from：与上一段（到 5 秒）重叠或倒序；各段要按时间先后排列',
    ])
    expect(issues({ version: 1, actions: [{ kind: 'click', at: 1, target: {} }] })).toEqual(['actions[0].target.selector：目标要给 selector、text 或 x/y 之一'])
    expect(issues({ version: 1, actions: [{ kind: 'zoom', at: 1, target: { x: 1, y: 2 }, steps: 0 }] })).toEqual(['actions[0].steps：缩放步数不能为 0'])
    expect(issues({ version: 1, pointer: [{ mode: 'path', from: 2, to: 4, points: [{ at: 5, x: 0, y: 0 }] }] })).toEqual(['pointer[0].points[0].at：要落在 2–4 秒内'])
    expect(issues({ version: 1, speed: 2 })[0]).toMatch(/^（整份）：/)
    expect(issues({ version: 2 })[0]).toMatch(/^version：/)
  })

  it('时刻不能超出录制长度', () => {
    const script = parseWebReplayDirector({ version: 1, clicks: [{ at: 90, target: { text: '发送' } }] })
    expect(() => checkDirectorAgainstRecording(script, 30 * S)).toThrow('clicks[0].at：90 秒超出录制长度（30.0 秒）')
  })
})

describe('时间线映射', () => {
  it('不写时间线就是整段 1 倍速', () => {
    const { timeline } = DirectorTimeline.build({ totalRecUs: 2 * S, fps: 4 })
    expect(timeline.frames).toBe(8)
    expect(timeline.at(0.75 * S)).toEqual({ recUs: 0.75 * S, pageUs: 0.75 * S })
    expect(timeline.placeRec(1.2 * S)).toEqual({ outUs: 1.2 * S, visible: true, after: false })
  })

  it('剪掉的区间不占输出时间，快放推进更多录制时间', () => {
    const { timeline } = DirectorTimeline.build({ totalRecUs: 60 * S, fps: 30, segments: [{ fromUs: 2 * S, toUs: 10 * S, speed: 1 }, { fromUs: 20 * S, toUs: 30 * S, speed: 2 }] })
    expect(timeline.durationUs).toBe(13 * S)
    expect(timeline.cuts.map(c => [c.recFromUs, c.recToUs, c.outUs])).toEqual([[0, 2 * S, 0], [10 * S, 20 * S, 8 * S]])
    expect(timeline.at(0).recUs).toBe(2 * S)
    expect(timeline.at(8 * S).recUs).toBe(20 * S)
    expect(timeline.at(10 * S).recUs).toBe(24 * S)
    expect(timeline.placeRec(15 * S)).toEqual({ outUs: 8 * S, visible: false, after: false })
    expect(timeline.placeRec(24 * S)).toEqual({ outUs: 10 * S, visible: true, after: false })
    expect(timeline.placeRec(40 * S).after).toBe(true)
  })

  it('平滑变速：速度线性过渡，录制总长与输出总长都不变', () => {
    const segments = [{ fromUs: 0, toUs: 10 * S, speed: 1 }, { fromUs: 10 * S, toUs: 40 * S, speed: 3 }]
    const hard = DirectorTimeline.build({ totalRecUs: 40 * S, fps: 30, segments }).timeline
    const { timeline } = DirectorTimeline.build({ totalRecUs: 40 * S, fps: 30, segments, rampUs: 1 * S })
    expect(timeline.durationUs).toBeCloseTo(hard.durationUs, 3)
    expect(timeline.at(9.5 * S).recUs).toBeCloseTo(9.5 * S, 0)
    expect(timeline.at(10.5 * S).recUs).toBeCloseTo(11.5 * S, 0)
    expect(timeline.speedAt(10 * S)).toBeCloseTo(2, 6)
    // 逆映射与正映射一致
    // 变速段从 9.5 秒起：录制走过 τ + τ²（秒），到 10.7 秒用 0.704 秒
    expect(timeline.placeRec(10.7 * S).outUs).toBeCloseTo(9.5 * S + 0.70416 * S, -2)
    expect(timeline.at(timeline.placeRec(10.7 * S).outUs).recUs).toBeCloseTo(10.7 * S, 0)
    // 每帧的录制时间只增不减，相邻帧的步长不跳
    const steps = Array.from({ length: timeline.frames - 1 }, (_, i) => timeline.at(timeline.frameOutUs(i + 1)).recUs - timeline.at(timeline.frameOutUs(i)).recUs)
    expect(Math.min(...steps)).toBeGreaterThan(0)
    expect(Math.max(...steps.slice(1).map((step, i) => Math.abs(step - steps[i])))).toBeLessThan(0.01 * S)
  })

  it('停住打字：录制时间停住、页面时间照走，之后页面时间比录制时间多出打字的时长', () => {
    const { timeline, dropped } = DirectorTimeline.build({ totalRecUs: 10 * S, fps: 30, holds: [{ recUs: 5 * S, durationUs: 2 * S, label: 'typewriter[0]' }] })
    expect(dropped).toEqual([])
    expect(timeline.durationUs).toBe(12 * S)
    expect(timeline.at(6 * S)).toEqual({ recUs: 5 * S, pageUs: 6 * S })
    expect(timeline.at(8 * S)).toEqual({ recUs: 6 * S, pageUs: 8 * S })
    expect(timeline.pageOfRec(5 * S)).toBe(5 * S)
    expect(timeline.pageOfRec(6 * S)).toBe(8 * S)
    expect(timeline.recOfPage(6 * S)).toBe(5 * S)
    expect(timeline.recOfPage(8 * S)).toBe(6 * S)
    expect(timeline.speedAt(6 * S)).toBe(0)
  })

  it('落在剪掉区间里的打字不停住', () => {
    const { timeline, dropped } = DirectorTimeline.build({ totalRecUs: 10 * S, fps: 30, segments: [{ fromUs: 0, toUs: 3 * S, speed: 1 }, { fromUs: 6 * S, toUs: 9 * S, speed: 1 }], holds: [{ recUs: 4 * S, durationUs: S, label: 'typewriter[0]' }] })
    expect(dropped).toHaveLength(1)
    expect(timeline.durationUs).toBe(6 * S)
  })
})

describe('打字机', () => {
  it('按字素拆开，标点后停得久一点，同一份稿子每次一样', () => {
    const plain = typewriterSchedule('交换机👍🏽好，', 10, 0, 1)
    expect(plain.chars).toEqual(['交', '换', '机', '👍🏽', '好', '，'])
    expect(plain.offsetsUs).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000])
    expect(plain.durationUs).toBe(720_000)
    const a = typewriterSchedule('千兆就够了', 12, 0.3, 7), b = typewriterSchedule('千兆就够了', 12, 0.3, 7)
    expect(a).toEqual(b)
    const gaps = a.offsetsUs.slice(1).map((t, i) => t - a.offsetsUs[i])
    for (const gap of gaps) { expect(gap).toBeGreaterThanOrEqual(1e6 / 12 * 0.7 - 1); expect(gap).toBeLessThanOrEqual(1e6 / 12 * 1.3 + 1) }
  })
})

const kinds = (ops: PlanOp[]): string[] => ops.map(op => (op.kind === 'event' ? `${op.event.kind}${'type' in op.event ? `:${op.event.type}` : ''}` : op.kind))

describe('执行清单', () => {
  it('没有导演稿时与录制一致：事件在自己的时刻、先于同刻的帧', () => {
    const events = [move(250_000, 1, 1), { kind: 'key', t: 600_000, type: 'down', key: 'a', code: 'KeyA', keyCode: 65, location: 0, repeat: false, mods: 0, composing: false } as WebRecordingBehaviorEvent]
    const plan = planWebReplay({ events, totalRecUs: S, fps: 4, viewport })
    expect(kinds(plan.ops)).toEqual(['frame', 'pointer:move', 'frame', 'frame', 'key:down', 'frame'])
    expect(plan.ops.filter(op => op.kind === 'event').map(op => [op.outUs, op.pageUs])).toEqual([[250_000, 250_000], [600_000, 600_000]])
    expect(plan.notes).toEqual([])
  })

  it('打字机：那次文字输入换成逐字输入，期间每帧照出，之后的事件页面时间往后挪', () => {
    const events: WebRecordingBehaviorEvent[] = [{ kind: 'text', t: 1 * S, data: '你好吗' }, press(1.5 * S, 'down', 10, 10)]
    const director = parseWebReplayDirector({ version: 1, typewriter: [{ at: 1, charsPerSecond: 10, jitter: 0 }] })
    const plan = planWebReplay({ director, events, totalRecUs: 2 * S, fps: 10, viewport })
    const typed = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'text' }> => op.kind === 'text')
    expect(typed.map(op => [op.text, op.outUs, op.pageUs, op.step])).toEqual([['你', S, S, 'typewriter[0]（逐字打字）'], ['好', 1.1 * S, 1.1 * S, 'typewriter[0]（逐字打字）'], ['吗', 1.2 * S, 1.2 * S, 'typewriter[0]（逐字打字）']])
    expect(plan.ops.some(op => op.kind === 'event' && op.event.kind === 'text')).toBe(false)
    expect(plan.timeline.durationUs).toBe(2.3 * S)
    const down = plan.ops.find(op => op.kind === 'event' && op.event.kind === 'pointer')!
    expect([down.outUs, down.pageUs, down.recUs]).toEqual([1.8 * S, 1.8 * S, 1.5 * S])
    // 打字期间的帧录制时间停在 1 秒、页面时间照走
    const frames = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'frame' }> => op.kind === 'frame' && op.outUs > S && op.outUs < 1.3 * S)
    expect(frames.map(op => [op.recUs, op.pageUs])).toEqual([[S, 1.1 * S], [S, 1.2 * S]])
  })

  it('剪掉的区间：事件照发但不出现在版本里，按不超过 50 毫秒一步推过去，不出帧', () => {
    const events = [move(1 * S, 5, 5), move(4 * S, 6, 6), move(8 * S, 7, 7)]
    const director = parseWebReplayDirector({ version: 1, timeline: { segments: [{ from: 0, to: 2 }, { from: 7, to: 9 }] } })
    const plan = planWebReplay({ director, events, totalRecUs: 9 * S, fps: 10, viewport })
    const cut = plan.ops.filter(op => op.outUs === 2 * S && op.kind !== 'frame')
    expect(cut.filter(op => op.kind === 'event').map(op => op.visible)).toEqual([false])
    const steps = cut.filter(op => op.kind === 'advance').map(op => op.pageUs)
    expect(steps[0]).toBe(2 * S + CUT_STEP_US)
    expect(steps.at(-1)).toBe(7 * S)
    expect(Math.max(...steps.slice(1).map((page, i) => page - steps[i]))).toBeLessThanOrEqual(CUT_STEP_US)
    // 帧都在留下的区间里
    const frames = plan.ops.filter(op => op.kind === 'frame')
    expect(frames).toHaveLength(40)
    expect(frames.every(op => op.recUs < 2 * S || op.recUs >= 7 * S)).toBe(true)
    // 推进与剪掉区间里的事件按页面时间交错
    const pages = cut.map(op => op.pageUs)
    expect(pages).toEqual([...pages].sort((a, b) => a - b))
  })

  it('注入点击：先滑到目标、按下松开、再滑回录制轨迹，其间录制的移动不发', () => {
    const events = [move(0.5 * S, 100, 100), move(1.9 * S, 110, 110), move(2.6 * S, 300, 300), move(3 * S, 320, 320)]
    const director = parseWebReplayDirector({ version: 1, actions: [{ kind: 'click', at: 2, target: { selector: '.go' }, approach: 0.5 }] })
    const plan = planWebReplay({ director, events, totalRecUs: 4 * S, fps: 10, viewport })
    expect(plan.anchors).toEqual([{ selector: '.go' }])
    const presses = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'event' }> => op.kind === 'event' && op.event.kind === 'pointer' && op.event.type !== 'move')
    expect(presses.map(op => [op.event.kind === 'pointer' && op.event.type, op.recUs, op.point, op.injected, op.step])).toEqual([
      ['down', 2 * S, { anchor: 0 }, true, 'actions[0]（点击）'],
      ['up', 2.08 * S, { anchor: 0 }, true, 'actions[0]（点击）'],
    ])
    const recordedMoves = plan.ops.filter(op => op.kind === 'event' && op.event.kind === 'pointer' && op.event.type === 'move').map(op => op.recUs)
    // 覆盖 1.5–2.58 秒：1.9 秒的移动不发，2.6 秒起照录制
    expect(recordedMoves).toEqual([0.5 * S, 2.6 * S, 3 * S])
    const moves = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'move' }> => op.kind === 'move')
    expect(moves[0].point).toEqual({ glide: 0, u: 0 })
    expect(moves.every(op => op.step === 'actions[0]（点击）')).toBe(true)
    expect(plan.glides[0]).toEqual({ from: { pointer: true }, to: { anchor: 0 }, easing: 'ease-in-out' })
    // 滑回的终点是录制在 2.58 秒时的位置
    expect(plan.glides[1].to).toEqual({ x: 110, y: 110 })
  })

  it('改点击位置：最近的那次按下与松开改到目标上', () => {
    const events = [press(3 * S, 'down', 10, 10), press(3.1 * S, 'up', 10, 10), press(5 * S, 'down', 50, 50)]
    const director = parseWebReplayDirector({ version: 1, clicks: [{ at: 3.2, target: { text: '发送' }, approach: 0 }] })
    const plan = planWebReplay({ director, events, totalRecUs: 6 * S, fps: 10, viewport })
    const presses = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'event' }> => op.kind === 'event')
    expect(presses.map(op => [op.recUs, op.point ?? null])).toEqual([[3 * S, { anchor: 0 }], [3.1 * S, { anchor: 0 }], [5 * S, null]])
  })

  it('滚动、缩放拆成滚轮步，拖动按下松开在两个目标', () => {
    const director = parseWebReplayDirector({ version: 1, actions: [
      { kind: 'scroll', at: 1, target: { selector: '.list' }, dy: 250, duration: 0.4 },
      { kind: 'zoom', at: 2, target: { x: 400, y: 300 }, steps: -2 },
      { kind: 'drag', at: 3, target: { selector: '.a' }, to: { selector: '.b' }, duration: 0.5 },
    ] })
    const plan = planWebReplay({ director, events: [], totalRecUs: 5 * S, fps: 10, viewport })
    const wheels = plan.ops.flatMap(op => (op.kind === 'event' && op.event.kind === 'wheel' ? [[op.recUs, op.event.dy, op.event.mods]] : []))
    expect(wheels.slice(0, 3)).toEqual([[1 * S, 250 / 3, 0], [1.2 * S, 250 / 3, 0], [1.4 * S, 250 / 3, 0]])
    expect(wheels.slice(3)).toEqual([[2 * S, 100, 2], [2.4 * S, 100, 2]])
    const drag = plan.ops.flatMap(op => (op.kind === 'event' && op.event.kind === 'pointer' ? [[op.event.type, op.recUs, op.point]] : []))
    expect(drag).toEqual([['down', 3 * S, { anchor: 1 }], ['up', 3.5 * S, { anchor: 2 }]])
  })

  it('平滑鼠标：期间录制的移动换成每帧一步的平滑路径，经过录制的点击位置', () => {
    const events = [move(0, 0, 0), move(0.3 * S, 50, 80), move(0.6 * S, 10, 20), press(0.8 * S, 'down', 100, 100), press(0.85 * S, 'up', 100, 100), move(1.2 * S, 200, 200)]
    const director = parseWebReplayDirector({ version: 1, pointer: [{ mode: 'smooth', from: 0.1, to: 1.1, every: 0.25 }] })
    const plan = planWebReplay({ director, events, totalRecUs: 2 * S, fps: 20, viewport })
    expect(plan.ops.filter(op => op.kind === 'event' && op.event.kind === 'pointer' && op.event.type === 'move').map(op => op.recUs)).toEqual([0, 1.2 * S])
    const moves = plan.ops.filter((op): op is Extract<PlanOp, { kind: 'move' }> => op.kind === 'move')
    const at = (recUs: number) => moves.find(op => Math.abs(op.recUs - recUs) < 1)!.point
    expect(at(0.8 * S)).toEqual({ x: 100, y: 100 })
    // 点完停着不动的那几帧不重复发移动
    expect(moves.length).toBe(16)
    expect(moves.at(-1)!.point).toEqual({ x: 100, y: 100 })
  })

  it('没对上的打字与点击写进提醒', () => {
    const director = parseWebReplayDirector({ version: 1, typewriter: [{ at: 1 }], clicks: [{ at: 2, target: { selector: '.x' } }] })
    const plan = planWebReplay({ director, events: [], totalRecUs: 3 * S, fps: 10, viewport })
    expect(plan.notes).toEqual(['typewriter[0]（逐字打字）：1 秒前后 0.3 秒内没有文字输入（带文件的粘贴不拆）', 'clicks[0]（改点击位置）：2 秒前后 0.5 秒内没有点击'])
  })
})
