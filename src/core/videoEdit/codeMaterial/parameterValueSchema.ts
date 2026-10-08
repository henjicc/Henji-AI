import { z } from 'zod'

const finite = z.number().finite()
const unit = finite.min(0).max(1)
const color = z.tuple([unit, unit, unit, unit])
const point = z.object({ x: finite, y: finite }).strict()
export const codeMaterialGradeValueSchema = z.object({ hue: finite.min(0).max(360), strength: unit, luminance: finite.min(-1).max(1) }).strict()
const gradient = z.array(z.object({ at: unit, color }).strict()).min(2).max(32).refine(stops => stops.every((stop, i) => !i || stop.at >= stops[i - 1].at), '渐变 at 必须非降序。')
const curve = z.array(z.object({ x: unit, y: unit }).strict()).min(2).max(64).refine(points => points[0].x === 0 && points.at(-1)!.x === 1 && points.every((point, i) => !i || point.x > points[i - 1].x), '曲线首尾 x=0/1，x 严格递增。')
export const codeMaterialParameterKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).refine(key => !['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments'].includes(key), '不允许的参数名称。')
// Four-number tuples also carry cubic Bézier values; declaration validation distinguishes them from RGBA.
export const codeMaterialBasicParameterValueSchema = z.union([finite, z.boolean(), z.string().max(4096), z.tuple([finite, finite, finite, finite]), z.tuple([finite, finite]).refine(value => value[0] <= value[1], 'range 必须 a≤b。'), point, codeMaterialGradeValueSchema, gradient, curve])
const structure = z.record(codeMaterialParameterKeySchema, codeMaterialBasicParameterValueSchema).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= 16, '自定义参数结构必须有 1–16 个基础字段，不能嵌套。')
export const codeMaterialAnimatedParameterValueSchema = z.union([codeMaterialBasicParameterValueSchema, structure])
export const codeMaterialImageReferenceSchema = z.object({ kind: z.literal('image'), mediaId: z.string().min(1).max(100) }).strict()
export const codeMaterialParameterValueSchema = z.union([codeMaterialAnimatedParameterValueSchema, codeMaterialImageReferenceSchema, z.null()])
