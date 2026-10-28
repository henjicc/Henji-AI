import { z } from 'zod'
import { videoEditNativeTemplateBodySchema } from '../document'
import { videoEditStyleSchema, videoEditTemplateCodeBodySchema, videoEditTemplateMetaShape } from './styleSchemas'
import { henjiExtension } from '../../fileExtensions'

/** 库模板（全局）：自带完整内容；用进工程时复制一份成为工程模板，记下来源与版本，库里更新不自动改工程。 */
export const videoEditTemplateBodySchema = z.discriminatedUnion('kind', [videoEditTemplateCodeBodySchema, videoEditNativeTemplateBodySchema])
export type VideoEditTemplateBody = z.infer<typeof videoEditTemplateBodySchema>
export const videoEditTemplateSchema = z.object({ ...videoEditTemplateMetaShape, imported: z.literal(true).optional(), body: videoEditTemplateBodySchema }).strict()
export type VideoEditTemplate = z.infer<typeof videoEditTemplateSchema>

/** 风格库目录里每个风格、每个模板各一份版本化 JSON 容器的内容。 */
export const VIDEO_EDIT_STYLE_LIBRARY_VERSION = 4
export const VIDEO_EDIT_TEMPLATE_LIBRARY_VERSION = 3

/**
 * 风格包分享文件（.hjsty）：说明书、样片代码、成员模板、预览视频、缩略图与锚点帧，版本号与内容摘要原样带上；不含字体。
 * 导入只解析和保存，不运行任何代码；媒体是 base64 文本，单个文件不超过 16 MB。
 */
export const VIDEO_EDIT_STYLE_PACKAGE_EXTENSION = henjiExtension('style_package').slice(1)
export const VIDEO_EDIT_STYLE_PACKAGE_VERSION = 6
export const VIDEO_EDIT_STYLE_PACKAGE_MAX_BYTES = 16 * 1024 * 1024
const base64 = z.string().max(12 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/, '媒体内容必须是 base64。')
export const videoEditStylePackageMediaSchema = z.object({
  preview: base64.optional().describe('预览视频（H.264 MP4，长边不超过 1920）。'),
  thumbnail: base64.optional().describe('缩略图（JPEG）。'),
  anchors: z.array(base64).max(10).describe('锚点帧（JPEG），顺序对应 sample.anchors。'),
}).strict()
export const videoEditStylePackageSchema = z.object({
  format: z.literal('henji-video-style'),
  style: videoEditStyleSchema,
  templates: z.array(videoEditTemplateSchema).max(64),
  media: videoEditStylePackageMediaSchema,
}).strict().superRefine((value, context) => {
  if (value.templates.some(template => template.style?.id !== value.style.id)) context.addIssue({ code: 'custom', path: ['templates'], message: '风格包里的模板必须属于这个风格。' })
  if (new Set(value.templates.map(template => template.id)).size !== value.templates.length) context.addIssue({ code: 'custom', path: ['templates'], message: '模板标识不能重复。' })
})
export type VideoEditStylePackage = z.infer<typeof videoEditStylePackageSchema>
