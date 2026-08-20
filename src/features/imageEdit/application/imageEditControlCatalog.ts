import { z } from 'zod'
import {
  IMAGE_BLUR_ALGORITHMS,
  type ImageBlurAlgorithmId,
} from '../../../core/imageEdit/blurParams'

const markLabelSchema = {
  label: z.string().max(500).optional(),
  labelFontSize: z.number().finite().min(1).max(1000).optional(),
  labelDx: z.number().finite().optional(),
  labelDy: z.number().finite().optional(),
}

const markStyleSchema = {
  stroke: z.string().trim().min(1).max(64),
  lineWidth: z.number().finite().min(0.1).max(100),
}

export const imageEditMarkItemSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('rect'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('ellipse'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('arrow'), points: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]), ...markStyleSchema, ...markLabelSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('pen'), points: z.array(z.number().finite()).min(4).refine((points) => points.length % 2 === 0, 'points 必须成对出现'), ...markStyleSchema }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('text'), x: z.number().finite(), y: z.number().finite(), text: z.string().max(10_000), color: z.string().trim().min(1).max(64), fontSize: z.number().finite().min(1).max(1000) }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('number'), x: z.number().finite(), y: z.number().finite(), color: z.string().trim().min(1).max(64), fontSize: z.number().finite().min(1).max(1000) }).strict(),
  z.object({ id: z.string().min(1).max(120).optional(), type: z.literal('mosaic'), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), strengthPercent: z.number().finite().min(0).max(100).optional(), mode: z.enum(['pixel', 'blur']).optional() }).strict(),
])

const rotationDegreesSchema = z.number().int().min(0).max(360).refine((degrees) => degrees % 90 === 0, 'degrees 必须是 90 的倍数').optional()
const blurAlgorithmIds = IMAGE_BLUR_ALGORITHMS.map((algorithm) => algorithm.id) as [
  ImageBlurAlgorithmId,
  ...ImageBlurAlgorithmId[],
]
const blurAlgorithmSchema = z.enum(blurAlgorithmIds)

export const imageEditOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rotate_cw'), degrees: rotationDegreesSchema }).strict(),
  z.object({ kind: z.literal('rotate_ccw'), degrees: rotationDegreesSchema }).strict(),
  z.object({ kind: z.literal('flip_h') }).strict(),
  z.object({ kind: z.literal('flip_v') }).strict(),
  z.object({ kind: z.literal('crop'), crop: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict() }).strict(),
  z.object({ kind: z.literal('mark'), item: imageEditMarkItemSchema }).strict(),
  z.object({ kind: z.literal('blur'), algorithm: blurAlgorithmSchema.optional(), strength: z.number().finite().min(0).max(1).optional() }).strict(),
])

export type ImageEditControlOperation = z.infer<typeof imageEditOperationSchema>
