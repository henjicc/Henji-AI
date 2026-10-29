import { z } from 'zod'
import { textStyleSchema } from '../../imaging/vectorContent/text'
import { CODE_VIDEO_SPAN_LIMIT, codeVideoSpansIssue } from './videoSpans'
import { CODE_WEB_BOX_LIMIT, CODE_WEB_SELECTOR_LENGTH, codeWebBoxesIssue, codeWebFolderOf, codeWebViewIssue } from './webSource'

const finite = z.number().finite()
const unit = finite.min(0).max(1)
const color = z.tuple([unit, unit, unit, unit])
const point = z.object({ x: finite, y: finite }).strict()
export const codeMaterialGradeValueSchema = z.object({ hue: finite.min(0).max(360), strength: unit, luminance: finite.min(-1).max(1) }).strict()
const gradient = z.array(z.object({ at: unit, color }).strict()).min(2).max(32).refine(stops => stops.every((stop, i) => !i || stop.at >= stops[i - 1].at), '渐变 at 必须非降序。')
const curve = z.array(z.object({ x: unit, y: unit }).strict()).min(2).max(64).refine(points => points.length >= 2 && points[0].x === 0 && points.at(-1)!.x === 1 && points.every((point, i) => !i || point.x > points[i - 1].x), '曲线首尾 x=0/1，x 严格递增。')
export const codeMaterialParameterKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(key => !['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments'].includes(key), '不允许的参数名称。')
// Four-number tuples also carry cubic Bézier values; declaration validation distinguishes them from RGBA.
export const codeMaterialBasicParameterValueSchema = z.union([finite, z.boolean(), z.string().max(4096), z.tuple([finite, finite, finite, finite]), z.tuple([finite, finite]).refine(value => value[0] <= value[1], 'range 必须 a≤b。'), point, codeMaterialGradeValueSchema, gradient, curve])
const structure = z.record(codeMaterialParameterKeySchema, codeMaterialBasicParameterValueSchema).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= 16, '自定义参数结构必须有 1–16 个基础字段，不能嵌套。')
export const codeMaterialTableValueSchema = z.array(z.record(codeMaterialParameterKeySchema, z.union([codeMaterialBasicParameterValueSchema, textStyleSchema])))
export const codeMaterialAnimatedParameterValueSchema = z.union([codeMaterialBasicParameterValueSchema, structure, textStyleSchema, codeMaterialTableValueSchema])
/** 视频参数的取帧时间表（语义见 CodeVideoSpan）：按 from 升序、互不重叠，与固定时刻 time 互斥。 */
export const codeMaterialVideoSpansSchema = z.array(z.object({ from: finite, to: finite, src: finite.nonnegative(), rate: finite.nonnegative().optional(), cursor: z.boolean().optional() }).strict()).min(1).max(CODE_VIDEO_SPAN_LIMIT).superRefine((spans, context) => {
  const issue = codeVideoSpansIssue(spans)
  if (issue) context.addIssue({ code: 'custom', message: issue })
})
const videoReference = z.object({ kind: z.literal('video'), mediaId: z.string().min(1).max(100), time: finite.nonnegative().optional(), spans: codeMaterialVideoSpansSchema.optional() }).strict().refine(value => value.time === undefined || value.spans === undefined, '视频参数的 time 与 spans 不能同时给出。')
/**
 * 网页画面（剪辑内容第 41 版）：本地网页的路径（内存里是绝对路径，落盘按位置写法换成项目相对）、视口、取景与倍率、
 * 取帧时刻与要读矩形的选择器。取景规则见 webSource.ts。
 */
const webReference = z.object({
  kind: z.literal('web'), path: z.string().min(1).max(4096).refine(value => !value.includes('\0') && codeWebFolderOf(value) !== undefined, '网页路径需要网页文件夹（含 index.html）或其中的 index.html。'),
  width: z.number().int().optional(), height: z.number().int().optional(), region: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]).optional(), scale: finite.optional(),
  time: finite.nonnegative().optional(), spans: codeMaterialVideoSpansSchema.optional(),
  boxes: z.array(z.string().min(1).max(CODE_WEB_SELECTOR_LENGTH)).max(CODE_WEB_BOX_LIMIT).optional(),
}).strict().superRefine((value, context) => {
  const issue = codeWebViewIssue(value) ?? (value.time !== undefined && value.spans !== undefined ? '网页参数的 time 与 spans 不能同时给出。' : undefined) ?? (value.boxes ? codeWebBoxesIssue(value.boxes) : undefined)
  if (issue) context.addIssue({ code: 'custom', message: issue })
})
export const codeMaterialImageReferenceSchema = z.union([z.object({ kind: z.literal('image'), mediaId: z.string().min(1).max(100) }).strict(), videoReference, z.object({ kind: z.literal('sequence'), mediaId: z.literal('below') }).strict(), webReference])
export const codeMaterialAudioReferenceSchema = z.object({ kind: z.literal('audio'), mediaId: z.string().min(1).max(100) }).strict()
/** 片子数据参数的值（剪辑内容第 37 版，作者接口 v5）：引用同一剪辑 scenes 里的一份，引用须存在由剪辑文档校验。 */
export const codeMaterialSceneReferenceSchema = z.object({ kind: z.literal('scene'), sceneId: z.string().min(1).max(100) }).strict()
export const codeMaterialParameterValueSchema = z.union([codeMaterialAnimatedParameterValueSchema, codeMaterialImageReferenceSchema, codeMaterialAudioReferenceSchema, codeMaterialSceneReferenceSchema, z.null()])
