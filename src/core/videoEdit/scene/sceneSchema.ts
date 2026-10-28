import { z } from 'zod'
import { codeMaterialParameterKeySchema } from '../codeMaterial/parameterValueSchema'
import { isCodeSceneReference } from '../codeMaterial/contract'
import type { VideoEditDocument } from '../document'

/**
 * 片子数据（剪辑内容第 37 版）：代码只管画法，“画什么”（段落、窗口内容时间表、框、组件、镜头落点、剪切）存成结构化记录。
 * 每条记录的 values 由代码声明的片子数据结构决定（sceneDeclaration.ts 按声明从严校验）；文档层只校验通用外形，
 * 因为声明写在作者代码里，打开文档时还没有运行代码。
 *
 * 时间约定：记录里的时刻一律是引用它的代码片段的素材时间（片段源时间，秒，0 = 素材开头，与取帧时间表 spans 同一条时间轴），
 * 未剪切——片子数据自己的剪切记录不改写其他记录的时刻，由读取方统一换算。片段在时间线上移动，内容跟着片段走。
 * 同一份片子数据可以被多个片段引用（例如台面、录屏窗口、标注三层整片代码片段读同一份），各片段按自己的素材时间解释；
 * 把它们分开移动就会彼此错开，那是用户自己的选择（像在 AE 里单独挪一层）。
 */
export const VIDEO_EDIT_SCENE_LIMITS = Object.freeze({ scenes: 64, records: 20_000, tuned: 64, pathLength: 512 })
const identifier = z.string().min(1).max(100)
/** 代码声明的结构标识，例如 dot-matrix.film：小写字母、数字与 . _ -，首尾是字母或数字。 */
export const videoEditSceneSchemaIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/, '片子数据结构标识只能用小写字母、数字与 . _ -，首尾是字母或数字，最多 100 字。')
const fieldName = '[A-Za-z][A-Za-z0-9_]{0,63}'
/** 手调过的字段路径：字段名，后面可接对象键或数组下标，用点分隔，例如 target、target.x、points.2。 */
export const videoEditSceneFieldPathSchema = z.string().max(VIDEO_EDIT_SCENE_LIMITS.pathLength).regex(new RegExp(`^${fieldName}(?:\\.(?:${fieldName}|0|[1-9]\\d{0,5}))*$`), '手调字段路径须为字段名，后接用点分隔的对象键或数组下标。')
export const videoEditSceneRecordSchema = z.object({
  id: identifier,
  kind: codeMaterialParameterKeySchema,
  parent: identifier.optional(),
  values: z.record(codeMaterialParameterKeySchema, z.json()),
  /** 用户手调过的字段：重新生成、重排时保留这些位置的值。没有手调时省略，不写空数组。 */
  tuned: z.array(videoEditSceneFieldPathSchema).min(1).max(VIDEO_EDIT_SCENE_LIMITS.tuned).refine(paths => new Set(paths).size === paths.length, '手调字段路径不能重复。').optional(),
}).strict()
export const videoEditSceneSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(200),
  /** 记录遵循的代码声明结构与版本，读取时须与代码参数声明的 schema 一致。 */
  schema: z.object({ id: videoEditSceneSchemaIdSchema, version: z.number().int().min(1).max(1_000_000) }).strict(),
  records: z.array(videoEditSceneRecordSchema).max(VIDEO_EDIT_SCENE_LIMITS.records),
}).strict().superRefine((scene, ctx) => {
  const records = new Map<string, VideoEditSceneRecord>()
  for (const record of scene.records) {
    if (records.has(record.id)) ctx.addIssue({ code: 'custom', message: `片子数据“${scene.name}”的记录标识重复：${record.id}` })
    records.set(record.id, record)
  }
  // 父级须在同一份片子数据内，且不能形成循环；已确认无环的链不再重复走。
  const acyclic = new Set<string>()
  for (const record of scene.records) {
    const chain = new Set([record.id]); let parent = record.parent; let valid = true
    while (parent !== undefined && !acyclic.has(parent)) {
      const next = records.get(parent)
      if (!next) { ctx.addIssue({ code: 'custom', message: `片子数据“${scene.name}”的记录 ${record.id} 的父级不存在：${parent}` }); valid = false; break }
      if (chain.has(parent)) { ctx.addIssue({ code: 'custom', message: `片子数据“${scene.name}”的记录父级形成循环：${record.id}` }); valid = false; break }
      chain.add(parent); parent = next.parent
    }
    if (valid) for (const id of chain) acyclic.add(id)
  }
})
export const videoEditScenesSchema = z.array(videoEditSceneSchema).max(VIDEO_EDIT_SCENE_LIMITS.scenes)
/** 代码参数对片子数据的引用必须指向本文档里存在的那份：素材项的初始参数、片段及片段上的代码效果都算。 */
export function videoEditSceneReferenceIssues(document: Pick<VideoEditDocument, 'scenes' | 'items' | 'sequences'>): string[] {
  const sceneIds = new Set(document.scenes?.map(scene => scene.id))
  const clips = document.sequences.flatMap(sequence => sequence.clips.flatMap(clip => [clip, ...(clip.takes ?? []).flatMap(take => take.linkedAudio?.map(entry => entry.clip) ?? [])]))
  const codes = [...document.items.map(item => item.code), ...clips.flatMap(clip => [clip.code, ...(clip.effects ?? []).map(effect => effect.code)])]
  return codes.flatMap(code => Object.values(code?.parameters ?? {})).flatMap(value => isCodeSceneReference(value) && !sceneIds.has(value.sceneId) ? [`代码参数引用的片子数据不存在：${value.sceneId}`] : [])
}
export type VideoEditScene = z.infer<typeof videoEditSceneSchema>
export type VideoEditSceneRecord = z.infer<typeof videoEditSceneRecordSchema>
