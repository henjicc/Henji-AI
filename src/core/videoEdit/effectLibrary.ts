import { z } from 'zod'
import { codeSourceHashSchema } from './codeMaterial/sources'
import { videoEditStyleCodeSnapshotSchema } from './styleCodeSnapshot'
import { videoEditEffectPresetSchema, type VideoEditEffectPreset } from './effectPresets'

// 内联源码只供历史库迁移读取；当前写入只保存内容摘要，分享文件仍带完整快照。
const storedSnapshot = z.object({ ...videoEditStyleCodeSnapshotSchema.shape, codeSources: z.array(z.object({ hash: codeSourceHashSchema, source: z.string().optional() }).strict()) }).strict()
const storedPreset = z.object({ ...videoEditEffectPresetSchema.shape, codeSnapshots: z.record(z.string(), storedSnapshot).optional() }).strict()
export const storedVideoEditEffectLibrarySchema = z.object({ favorites: z.array(z.string()), presets: z.array(storedPreset) }).strict()
export type StoredVideoEditEffectLibrary = z.infer<typeof storedVideoEditEffectLibrarySchema>
export function storedVideoEditEffectLibrary(value: { favorites: string[]; presets: VideoEditEffectPreset[] }): StoredVideoEditEffectLibrary {
  return { favorites: value.favorites, presets: value.presets.map(preset => ({ ...preset, ...(preset.codeSnapshots ? { codeSnapshots: Object.fromEntries(Object.entries(preset.codeSnapshots).map(([id, snapshot]) => [id, { ...snapshot, codeSources: snapshot.codeSources.map(({ hash }) => ({ hash })) }])) } : {}) })) }
}
