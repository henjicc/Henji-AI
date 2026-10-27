import { z } from 'zod'

/**
 * 重演导演稿：重演时不完全照录制来，按它改时间与操作，出给片子用的“版本”（take）。
 *
 * 时间都按录制时间（秒，与 read_web_app_recording 行为轨的时刻同一条时间线）写：
 * - timeline：留下哪些录制时间区间、各自多快；没列出的区间剪掉（页面照样在后台推过去，不出画面）；
 *   ramp 给相邻且首尾相接的两段之间的速度变化加平滑过渡（输出秒）。不写 timeline 就是整段 1 倍速。
 * - typewriter：把输入框里一次插进去的文字（text / paste）拆成逐字输入；打字期间录制时间停住，
 *   按每秒字数在输出里多出打字的时间。
 * - pointer：某段录制时间里的鼠标移动换成平滑路径（smooth）或给定的关键点路径（path，带缓动）；点击的时刻不变。
 * - clicks：把某次点击改到指定元素上（鼠标提前滑过去）。
 * - actions：在某个录制时刻注入点击、悬停、按元素滚动、拖动、缩放画布。
 *
 * 导演稿只改时间与输入，页面拿到的数据仍全部来自录制：改出来的操作发出录制里没有的请求时按冲突报告，
 * 不会联网。v1 起登记为持久格式 web-replay-director（versionSource: director.json.version）。
 */
export const WEB_REPLAY_DIRECTOR_VERSION = 1

const seconds = z.number().finite().nonnegative()
const finite = z.number().finite()

/** 页面里的一个元素或一个点：CSS 选择器、文字，或视口 CSS 像素坐标。 */
export const directorTargetSchema = z.object({
  selector: z.string().trim().min(1).max(1000).optional().describe('CSS 选择器，如 ".ask-submit" 或 "[data-replay-id=\\"node-n5\\"]"'),
  text: z.string().trim().min(1).max(500).optional().describe('按看得见的文字找元素（包含这段文字的最小元素）'),
  index: z.number().int().nonnegative().max(1000).optional().describe('同样匹配的第几个（从 0 开始），默认 0'),
  offset: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional().describe('落在元素里的位置（按元素宽高比例），默认 [0.5, 0.5] 正中'),
  x: finite.optional().describe('视口 CSS 像素横坐标（不按元素时用）'),
  y: finite.optional().describe('视口 CSS 像素纵坐标'),
}).strict().superRefine((target, ctx) => {
  const point = target.x !== undefined || target.y !== undefined
  if (point && (target.x === undefined || target.y === undefined)) ctx.addIssue({ code: 'custom', path: [target.x === undefined ? 'x' : 'y'], message: '坐标要同时给 x 和 y' })
  if (!target.selector && !target.text && !point) ctx.addIssue({ code: 'custom', path: ['selector'], message: '目标要给 selector、text 或 x/y 之一' })
})
export type DirectorTarget = z.infer<typeof directorTargetSchema>

export const directorEasingSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
export type DirectorEasing = z.infer<typeof directorEasingSchema>

const segmentSchema = z.object({
  from: seconds.describe('录制时间（秒）'), to: seconds.describe('录制时间（秒），大于 from'),
  speed: z.number().min(0.1).max(16).default(1).describe('倍速：2 是快一倍，0.5 是慢一半'),
}).strict()

const typewriterSchema = z.object({
  at: seconds.optional().describe('哪一次文字输入（录制时间，秒，误差 0.3 秒内）；不给时所有文字输入都拆成逐字'),
  charsPerSecond: z.number().min(1).max(60).default(12).describe('每秒打几个字'),
  jitter: z.number().min(0).max(0.9).default(0.3).describe('字与字间隔的随机浮动比例，0 是匀速'),
}).strict()

const pathPointSchema = z.object({
  at: seconds.describe('到达这个点的录制时间（秒）'),
  x: finite.optional(), y: finite.optional(), target: directorTargetSchema.optional(),
}).strict().superRefine((point, ctx) => {
  if (!point.target && (point.x === undefined || point.y === undefined)) ctx.addIssue({ code: 'custom', path: ['x'], message: '关键点给 x/y 坐标或 target 元素' })
})

const pointerSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('smooth'), from: seconds, to: seconds, every: z.number().min(0.05).max(2).default(0.25).describe('每隔多少秒取一个关键点再连成平滑曲线；越大越顺') }).strict(),
  z.object({ mode: z.literal('path'), from: seconds, to: seconds, points: z.array(pathPointSchema).min(1).max(200), easing: directorEasingSchema.default('ease-in-out') }).strict(),
])

const clickSchema = z.object({
  at: seconds.describe('要改的那次点击（录制时间，秒，误差 0.5 秒内）'),
  target: directorTargetSchema,
  approach: z.number().min(0).max(3).default(0.35).describe('点击前鼠标滑到目标、点完滑回录制轨迹各用多少秒（录制时间）'),
}).strict()

const action = {
  at: seconds.describe('录制时间（秒）：鼠标到达目标、动作开始的时刻'),
  target: directorTargetSchema,
  approach: z.number().min(0).max(3).default(0.35).describe('动作前鼠标从当前位置滑到目标、动作后滑回录制轨迹各用多少秒（录制时间）；0 是直接跳过去'),
}
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), ...action, button: z.enum(['left', 'right']).default('left') }).strict(),
  z.object({ kind: z.literal('hover'), ...action, duration: z.number().min(0).max(10).default(1).describe('在目标上停多少秒') }).strict(),
  z.object({ kind: z.literal('scroll'), ...action, dy: finite.describe('在目标所在的滚动区域滚动多少 CSS 像素，向下为正'), dx: finite.default(0), duration: z.number().min(0).max(10).default(0.4).describe('滚动用多少秒') }).strict(),
  z.object({ kind: z.literal('drag'), ...action, to: directorTargetSchema.describe('拖到哪里'), duration: z.number().min(0.05).max(10).default(0.6).describe('拖动用多少秒') }).strict(),
  z.object({ kind: z.literal('zoom'), ...action, steps: z.number().int().min(-50).max(50).refine(value => value !== 0, '缩放步数不能为 0').describe('在目标处按住 Ctrl 滚轮的格数：正数放大，负数缩小'), duration: z.number().min(0).max(10).default(0.4).describe('缩放用多少秒') }).strict(),
])
export type DirectorAction = z.infer<typeof actionSchema>

export const webReplayDirectorSchema = z.object({
  version: z.literal(WEB_REPLAY_DIRECTOR_VERSION),
  timeline: z.object({
    segments: z.array(segmentSchema).min(1).max(500).describe('留下的录制时间区间，按时间先后、不重叠；区间之间没列出的剪掉'),
    ramp: z.number().min(0).max(5).default(0).describe('相邻两段首尾相接且速度不同时，用多少输出秒平滑过渡；0 是直接换速'),
  }).strict().optional(),
  typewriter: z.array(typewriterSchema).max(200).optional(),
  pointer: z.array(pointerSchema).max(200).optional(),
  clicks: z.array(clickSchema).max(200).optional(),
  actions: z.array(actionSchema).max(500).optional(),
}).strict().superRefine((script, ctx) => {
  const segments = script.timeline?.segments ?? []
  segments.forEach((segment, index) => {
    if (segment.to <= segment.from) ctx.addIssue({ code: 'custom', path: ['timeline', 'segments', index, 'to'], message: `要大于 from（${segment.from}）` })
    const previous = segments[index - 1]
    if (previous && segment.from < previous.to) ctx.addIssue({ code: 'custom', path: ['timeline', 'segments', index, 'from'], message: `与上一段（到 ${previous.to} 秒）重叠或倒序；各段要按时间先后排列` })
  })
  script.pointer?.forEach((range, index) => {
    if (range.to <= range.from) ctx.addIssue({ code: 'custom', path: ['pointer', index, 'to'], message: `要大于 from（${range.from}）` })
    if (range.mode !== 'path') return
    range.points.forEach((point, k) => {
      if (point.at < range.from || point.at > range.to) ctx.addIssue({ code: 'custom', path: ['pointer', index, 'points', k, 'at'], message: `要落在 ${range.from}–${range.to} 秒内` })
      if (k > 0 && point.at <= range.points[k - 1].at) ctx.addIssue({ code: 'custom', path: ['pointer', index, 'points', k, 'at'], message: '关键点要按时间先后排列' })
    })
  })
})
export type WebReplayDirector = z.infer<typeof webReplayDirectorSchema>
export type WebReplayDirectorInput = z.input<typeof webReplayDirectorSchema>

/** 导演稿校验失败：每条都点名字段路径，如 timeline.segments[2].to。 */
export class WebReplayDirectorError extends Error {
  constructor(readonly issues: string[]) {
    super(`导演稿有 ${issues.length} 处不对：${issues.join('；')}`)
    this.name = 'WebReplayDirectorError'
  }
}

function fieldPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => (typeof key === 'number' ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)), '') || '（整份）'
}

/** 按 schema 校验并补默认值；失败抛 WebReplayDirectorError，逐条写明字段。 */
export function parseWebReplayDirector(value: unknown): WebReplayDirector {
  const parsed = webReplayDirectorSchema.safeParse(value)
  if (!parsed.success) throw new WebReplayDirectorError(parsed.error.issues.map(issue => `${fieldPath(issue.path)}：${issue.message}`))
  return parsed.data
}

/** 与录制本身对照：时刻不能超出录制长度。 */
export function checkDirectorAgainstRecording(script: WebReplayDirector, durationUs: number): void {
  const limit = durationUs / 1e6 + 2
  const issues: string[] = []
  const check = (path: string, at: number): void => { if (at > limit) issues.push(`${path}：${at} 秒超出录制长度（${(durationUs / 1e6).toFixed(1)} 秒）`) }
  script.timeline?.segments.forEach((segment, index) => check(`timeline.segments[${index}].from`, segment.from))
  script.typewriter?.forEach((rule, index) => { if (rule.at !== undefined) check(`typewriter[${index}].at`, rule.at) })
  script.pointer?.forEach((range, index) => check(`pointer[${index}].from`, range.from))
  script.clicks?.forEach((click, index) => check(`clicks[${index}].at`, click.at))
  script.actions?.forEach((step, index) => check(`actions[${index}].at`, step.at))
  if (issues.length) throw new WebReplayDirectorError(issues)
}

/** 版本名：录制文件夹下 takes/<名字>/ 的文件夹名。 */
// eslint-disable-next-line no-control-regex -- 文件夹名里不能有控制字符
export const webReplayTakeNameSchema = z.string().trim().min(1).max(80).regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/, '版本名不能含 \\ / : * ? " < > | 等字符').refine(name => !name.startsWith('.') && !name.endsWith('.'), '版本名不能以 . 开头或结尾')
