import { assertMemoryContentSafe } from './memoryPolicy'
import { z } from 'zod'

export const MEMORY_ENTRY_MAX_LENGTH = 200
export const MEMORY_HISTORY_LIMIT = 100
export const MEMORY_LIMITS = {
  global: { entries: 60, characters: 3000 },
  project: { entries: 40, characters: 2000 },
  style: { entries: 30, characters: 1500 },
} as const
export const memoryLayerSchema = z.enum(['global', 'project', 'style'])
export type MemoryLayer = z.infer<typeof memoryLayerSchema>
const sentence = z.string().trim().min(1).max(MEMORY_ENTRY_MAX_LENGTH).refine(value => !/[\0\r\n]/.test(value), '请用一句话记录记忆。')
export const memoryValueSchema = z.discriminatedUnion('key', [
  z.object({ key: z.enum(['font.zh', 'font.latin', 'font.numeric']), fonts: z.array(z.string().trim().min(1).max(100)).min(1).max(12) }).strict(),
  z.object({ key: z.literal('style'), id: z.string().min(1).max(100) }).strict(),
  z.object({ key: z.literal('voice'), providerId: z.string().min(1).max(100), voiceId: z.string().min(1).max(200) }).strict(),
  z.object({ key: z.literal('aspect'), width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384) }).strict(),
])
export const memoryEntrySchema = z.object({
  id: z.string().min(1).max(100),
  section: z.enum(['about', 'creative', 'habits']).optional(),
  content: sentence,
  source: z.enum(['user', 'assistant']),
  precedence: z.enum(['style', 'preference']).optional(),
  value: memoryValueSchema.optional(),
  reason: sentence.optional(),
  updatedAt: z.iso.datetime({ offset: true }),
  revision: z.number().int().positive(),
}).strict()
export type MemoryEntry = z.infer<typeof memoryEntrySchema>
export type MemoryValue = z.infer<typeof memoryValueSchema>
export const memoryEntryInputSchema = memoryEntrySchema.omit({ id: true, updatedAt: true, revision: true })
export type MemoryEntryInput = z.infer<typeof memoryEntryInputSchema>
export const memoryTargetSchema = z.discriminatedUnion('layer', [
  z.object({ layer: z.literal('global') }).strict(),
  z.object({ layer: z.literal('project'), ownerId: z.string().min(1).max(300) }).strict(),
  z.object({ layer: z.literal('style'), ownerId: z.string().min(1).max(100) }).strict(),
])
export type MemoryTarget = z.infer<typeof memoryTargetSchema>

/** 三层共用条目结构；分区、优先级与默认值的使用范围在所属集合边界检查。 */
export function memoryEntriesSchema(layer: MemoryLayer): z.ZodArray<typeof memoryEntrySchema> {
  return z.array(memoryEntrySchema).max(MEMORY_LIMITS[layer].entries).superRefine((entries, context) => {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) context.addIssue({ code: 'custom', message: '记忆条目标识不能重复。' })
    if (entries.reduce((total, entry) => total + entry.content.length, 0) > MEMORY_LIMITS[layer].characters) context.addIssue({ code: 'custom', message: `记忆最多 ${MEMORY_LIMITS[layer].characters} 字，请先整理。` })
    entries.forEach((entry, index) => {
      try { assertMemoryContentSafe(JSON.stringify(entry)) } catch (error) { context.addIssue({ code: 'custom', path: [index], message: error instanceof Error ? error.message : '记忆包含不能保存的信息。' }) }
      if ((layer === 'global') !== (entry.section !== undefined)) context.addIssue({ code: 'custom', path: [index, 'section'], message: '只有全局记忆需要分区。' })
      if (entry.precedence !== undefined && (layer !== 'global' || entry.section !== 'creative')) context.addIssue({ code: 'custom', path: [index, 'precedence'], message: '只有全局创作偏好可以设置冲突优先级。' })
      if (entry.value && (layer === 'style' || (layer === 'global' && entry.section !== 'creative'))) context.addIssue({ code: 'custom', path: [index, 'value'], message: '默认值只属于项目记忆或全局创作偏好。' })
    })
  })
}
export const globalMemoryEntriesSchema = memoryEntriesSchema('global')
export const projectMemoryEntriesSchema = memoryEntriesSchema('project')
export const styleMemoryEntriesSchema = memoryEntriesSchema('style')
export const memoryHistoryEntrySchema = z.object({
  id: z.string().min(1), target: memoryTargetSchema, entryId: z.string().min(1),
  actor: z.enum(['user', 'assistant']), before: memoryEntrySchema.nullable(), after: memoryEntrySchema.nullable(),
  reason: sentence, createdAt: z.iso.datetime({ offset: true }), reverts: z.string().optional(),
}).strict()
export type MemoryHistoryEntry = z.infer<typeof memoryHistoryEntrySchema>
export const memorySettingsSchema = z.object({ enabled: z.boolean(), autoOrganize: z.boolean() }).strict()
export type MemorySettings = z.infer<typeof memorySettingsSchema>
export const memorySnapshotSchema = z.object({
  settings: memorySettingsSchema, entries: globalMemoryEntriesSchema,
  history: z.array(memoryHistoryEntrySchema).max(MEMORY_HISTORY_LIMIT),
  revision: z.number().int().nonnegative(), changesSinceOrganization: z.number().int().nonnegative(),
  lastOrganizedAt: z.iso.datetime({ offset: true }).nullable(),
  needsOrganization: z.boolean().optional(),
}).strict()
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>

export function emptyMemorySnapshot(): MemorySnapshot {
  return { settings: { enabled: true, autoOrganize: true }, entries: [], history: [], revision: 0, changesSinceOrganization: 0, lastOrganizedAt: null }
}

/** 未显式选择优先级时返回询问标志，同时以风格作为确定性默认；不把缺省写成用户决定。 */
export function resolveMemoryValue(key: MemoryValue['key'], global: readonly MemoryEntry[], project: readonly MemoryEntry[], styleValue?: MemoryValue): { value?: MemoryValue; askUser: boolean } {
  const latest = (entries: readonly MemoryEntry[]): MemoryEntry | undefined => entries.filter(entry => entry.value?.key === key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision)[0]
  const local = latest(project)
  if (local) return { value: local.value, askUser: false }
  const preference = latest(global)
  if (!styleValue) return { value: preference?.value, askUser: false }
  const conflict = preference?.value !== undefined && JSON.stringify(preference.value) !== JSON.stringify(styleValue)
  return { value: preference?.precedence === 'preference' ? preference.value : styleValue, askUser: conflict && preference?.precedence === undefined }
}

export function firstAvailableMemoryFont(fonts: readonly string[], installed: readonly string[]): string | undefined {
  const available = new Map(installed.map(font => [font.toLocaleLowerCase(), font]))
  return fonts.map(font => available.get(font.toLocaleLowerCase())).find(font => font !== undefined)
}

export function shouldOrganizeMemory(state: Pick<MemorySnapshot, 'settings' | 'changesSinceOrganization' | 'lastOrganizedAt' | 'needsOrganization'>, now: Date, overCapacity = false): boolean {
  return state.settings.enabled && state.settings.autoOrganize
    && (state.changesSinceOrganization >= 10 || state.needsOrganization || overCapacity)
    && (!state.lastOrganizedAt || state.lastOrganizedAt.slice(0, 10) !== now.toISOString().slice(0, 10))
}

export const MEMORY_RULES = '每个新任务先读取最新全局记忆；在项目内工作时读取项目记忆，使用风格时读取使用者偏好。当前要求 > 项目 > 风格及风格偏好 > 全局；全局创作偏好缺省听风格，但缺省不代表用户已作出冲突选择。新增普通偏好必须省略 precedence；“我一般用思源黑体，别用宋体”等表达只说明喜好，绝不表示偏好优先。只有用户回答了风格与偏好的冲突询问，或明确说“就算风格不同也按我的”等跨风格覆盖要求，才可按该明确选择写 precedence=style/preference，并在 reason 记录用户的选择依据；不得自行补写、推断或承诺以后冲突不再询问。全局偏好与风格冲突且未设 precedence 时，回答第一句必须先问用户听风格还是听偏好，再简述差异；本轮不推荐字体、不动手、不写 precedence，等明确答复后再逐条更新。已明确 precedence=preference 才压过风格。这次/这期/项目内容记项目；某风格外观记风格；我一般/以后都/所有记全局。说不清时记窄，不从一次使用推断。纠错只改对应条目，矛盾以较新为准并说明原因；关闭记忆时不读不写。'
