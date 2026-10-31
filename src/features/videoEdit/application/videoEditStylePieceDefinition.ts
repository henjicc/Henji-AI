import { z } from 'zod'
import { videoEditEffectPresetSchema, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { videoEditEffectSchema, type VideoEditEffect } from '@/core/videoEdit/compositing'
import { requireVideoEditInstance } from './videoEditService'
import { videoEditCompositeOwner } from './videoEditCompositeEntities'
import { splitVideoEditRef } from './videoEditRefs'
import { snapshotVideoEditStyleEffects } from './videoEditStyleCode'
import { sha256HexString } from '@/utils/save/hash'
import type { VideoEditStyleCodeSnapshot } from '@/core/videoEdit/styleCodeSnapshot'

export const videoEditStyleEffectReferenceSchema = z.object({ id: videoEditEffectSchema.shape.id.optional(), ref: z.object({ kind: z.literal('video_edit.effect'), id: z.string().min(1), label: z.string().optional() }).strict() }).strict()
export const videoEditStylePieceDefinitionInputSchema = z.object({ ...videoEditEffectPresetSchema.shape, id: videoEditEffectPresetSchema.shape.id.optional(), effects: z.array(z.union([videoEditEffectSchema, videoEditStyleEffectReferenceSchema])).min(1) }).strict()

const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
/** 原始快照只用于读回后修改；新增成员由引用捕获，来源始终取宿主已有记录。 */
export async function resolveVideoEditStylePieceDefinition(value: unknown, id: string, signal?: AbortSignal, previous?: VideoEditEffectPreset): Promise<VideoEditEffectPreset> {
  const input = videoEditStylePieceDefinitionInputSchema.parse(value)
  const effects: VideoEditEffect[] = [], snapshots: Record<string, VideoEditStyleCodeSnapshot> = {}
  for (const [key, incoming] of Object.entries(input.codeSnapshots ?? {})) {
    const withoutForeign = (snapshot: VideoEditStyleCodeSnapshot): unknown => { const { foreign: _foreign, ...version } = snapshot.version; return { ...snapshot, version } }
    const original = previous?.codeSnapshots?.[key]
    if (original && stable(withoutForeign(original)) !== stable(withoutForeign(incoming))) throw new Error('已有代码快照不能改写；替换代码成员请使用 {ref: video_edit.effect 引用}。')
    if (!original) throw new Error('新的代码成员请使用 {ref: video_edit.effect 引用}，不能直接写入原始代码快照。')
    for (const source of incoming.codeSources) if (await sha256HexString(source.source) !== source.hash) throw new Error('代码快照的源码摘要不符。')
    snapshots[key] = structuredClone(original)
  }
  for (const member of input.effects) {
    if (!('ref' in member)) { effects.push(member); continue }
    const { projectId, childId } = splitVideoEditRef(member.ref)
    const selected = videoEditCompositeOwner(requireVideoEditInstance(projectId).document, 'video_edit.effect', childId)
    if (selected.kind !== 'effect') throw new Error('请选择片段上的效果引用。')
    const effect = selected.effect
    const captured = await snapshotVideoEditStyleEffects(projectId, [{ ...effect, id: member.id ?? effect.id }], signal)
    effects.push(...captured.effects); Object.assign(snapshots, captured.codeSnapshots)
  }
  return videoEditEffectPresetSchema.parse({ ...input, id, effects, ...(Object.keys(snapshots).length ? { codeSnapshots: snapshots } : {}) })
}

export async function resolveVideoEditStyleMembers(value: unknown, previous: readonly VideoEditEffectPreset[] = [], signal?: AbortSignal): Promise<VideoEditEffectPreset[]> {
  const inputs = z.array(videoEditStylePieceDefinitionInputSchema).parse(value)
  return Promise.all(inputs.map(input => resolveVideoEditStylePieceDefinition(input, input.id ?? crypto.randomUUID(), signal, previous.find(preset => preset.id === input.id))))
}
