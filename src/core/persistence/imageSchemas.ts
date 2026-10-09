import { imageEditSparseMaskSchemaV3, imageEditMaskAttachmentSchemaV3, imageEditLayerFiltersSchemaV3 } from '../imageEdit/v3/layerModel/semantics'
import { listImagingEffects } from '../imaging/effects/registry'
import { imageColorGradeParamsSchema } from '../imaging/adjustments/schema'
import { z } from 'zod'
import { imageEditHistoryCheckpointSchemaV3 } from '../imageEdit/v3/historyPaging/schema'
import { IMAGE_EDIT_DOCUMENT_VERSION_V3 } from '../imageEdit/v3/documentTypes'
import { IMAGE_HEADER_VERSION, IMAGE_PACKAGE_VERSION, IMAGE_WORKING_VERSION } from './schemaVersions'

const integer = z.number().int().nonnegative()
const identifier = z.string().min(1)
const jsonObject = z.record(z.string(), z.json())
const resource = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const chromaticity = z.object({ x: z.number(), y: z.number() })
const hdrMetadata = z.object({ standard: z.enum(['pq', 'hlg']), referenceWhiteNits: z.number(), cicp: z.object({ colorPrimaries: z.number(), transferCharacteristics: z.number(), matrixCoefficients: z.number(), fullRange: z.boolean() }), contentLight: z.object({ maxContentLightLevelNits: z.number(), maxFrameAverageLightLevelNits: z.number() }).optional(), masteringDisplay: z.object({ red: chromaticity, green: chromaticity, blue: chromaticity, whitePoint: chromaticity, maxLuminanceNits: z.number(), minLuminanceNits: z.number() }).optional() })
const common = { id: identifier, name: z.string(), visible: z.boolean(), locked: z.boolean(), opacity: z.number().min(0).max(1), fillOpacity: z.number().min(0).max(1), clipping: z.boolean(), maskAttachment: imageEditMaskAttachmentSchemaV3, filters: imageEditLayerFiltersSchemaV3, blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']), transform: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]), mask: imageEditSparseMaskSchemaV3.nullable() }
export const imageLayerSchema: z.ZodType = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('raster'), source: z.union([z.object({ kind: z.literal('empty') }), z.object({ kind: z.literal('resource'), resourceId: identifier })]), tiles: z.record(z.string(), identifier) }),
  z.object({ ...common, type: z.literal('annotation'), annotations: z.array(jsonObject) }),
  z.object({ ...common, type: z.literal('effect'), effectId: identifier,
    params: z.union([jsonObject, ...listImagingEffects().filter(effect => effect.hosts.includes('image')).map(effect => effect.parameterSchema)]),
    renderable: z.boolean(),
  }).strict().superRefine((layer, context) => {
    const descriptor = listImagingEffects().find(effect => effect.id === layer.effectId && effect.hosts.includes('image'))
    if (layer.effectId === 'image.blur') { context.addIssue({ code: 'custom', path: ['effectId'], message: '图片效果未登记' }); return }
    if (!descriptor) return
    const result = descriptor.parameterSchema.safeParse(layer.params)
    if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ['params', ...issue.path] })
  }),
  z.object({ ...common, type: z.literal('adjustment'), adjustmentId: identifier, params: z.union([jsonObject, imageColorGradeParamsSchema]), renderable: z.boolean() }).superRefine((layer, context) => {
    if (layer.adjustmentId === 'color_grade') {
      const result = imageColorGradeParamsSchema.safeParse(layer.params)
      if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ['params', ...issue.path] })
    }
  }),
  z.object({ ...common, type: z.literal('group'), children: z.array(imageLayerSchema), isolated: z.boolean() }),
]))
export const imageContentSchema = z.object({
  version: z.literal(IMAGE_EDIT_DOCUMENT_VERSION_V3), id: identifier, revision: integer,
  geometry: z.object({ width: integer, height: integer, orientation: z.object({ rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), mirrored: z.boolean() }), crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable() }),
  color: z.object({ workingSpace: z.enum(['srgb', 'display-p3', 'rec2020']), bitDepth: z.union([z.literal(8), z.literal(16), z.literal('float16'), z.literal('float32')]), transferFunction: z.enum(['srgb', 'linear', 'pq', 'hlg']), hdrMetadata: hdrMetadata.nullable(), iccProfileResourceId: identifier.nullable() }),
  layers: z.array(imageLayerSchema),
})
export const imageWorkingCopySchema = z.object({ format: z.literal('henji-image-edit'), formatVersion: z.literal(IMAGE_WORKING_VERSION), documentId: identifier, revision: integer, createdAt: z.string(), updatedAt: z.string(), document: imageContentSchema, historyCheckpoint: imageEditHistoryCheckpointSchemaV3.optional(), resourceRefs: z.array(resource), previewRef: resource.optional() }).strict()
export const imageDocumentHeaderSchema = z.object({ format: z.literal('henji-image-document'), version: z.literal(IMAGE_HEADER_VERSION), id: identifier, draft: z.boolean().optional(), revision: integer, kindVersion: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), contentRevision: integer, emptyUntilRevision: integer.nullable().optional(), summary: z.object({ width: integer, height: integer, layers: integer }) })
export const imagePackageManifestSchema = z.object({ packageFormat: z.literal('henjiimg'), packageVersion: z.literal(IMAGE_PACKAGE_VERSION), createdAt: z.string(), document: imageWorkingCopySchema,
  resources: z.array(z.object({ resourceId: resource, sha256: z.string(), byteLength: integer, path: z.string(), mediaType: z.string().optional() })),
  thumbnail: z.object({ path: z.string(), sha256: z.string(), byteLength: integer, mediaType: z.string() }).optional(),
  externalSources: z.array(z.object({ sha256: z.string(), byteLength: integer.optional(), mediaType: z.string().optional(), pathHint: z.string().optional(), relinkHint: z.string().optional() })).optional(),
})
