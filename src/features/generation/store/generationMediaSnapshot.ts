import type { GenerationDraft } from '../domain/generationDraft'
import { useGenerationDraftStore } from './generationDraftStore'

/** 生成页参考素材的全部状态：图片、视频、音频、混排顺序与视频裁切。撤销参考素材的增删就是整份换回快照。 */
const GENERATION_MEDIA_FIELDS = [
  'uploadedPromptImages',
  'uploadedFilePaths',
  'uploadedVideos',
  'uploadedVideoFiles',
  'uploadedVideoFilePaths',
  'uploadedAudios',
  'uploadedAudioFilePaths',
  'fileOrder',
  'uploadedVideoDuration',
  'uploadedVideoTrimStart',
  'uploadedVideoTrimEnd',
] as const satisfies readonly (keyof GenerationDraft)[]

export type GenerationMediaSnapshot = Pick<GenerationDraft, typeof GENERATION_MEDIA_FIELDS[number]>

export function readGenerationMediaSnapshot(): GenerationMediaSnapshot {
  const { draft } = useGenerationDraftStore.getState()
  return Object.fromEntries(GENERATION_MEDIA_FIELDS.map(key => [key, draft[key]])) as GenerationMediaSnapshot
}

/** draft 的字段都是不可变值，引用相同即未变。 */
export function generationMediaSnapshotsEqual(left: GenerationMediaSnapshot, right: GenerationMediaSnapshot): boolean {
  return GENERATION_MEDIA_FIELDS.every(key => left[key] === right[key])
}

export function restoreGenerationMediaSnapshot(snapshot: GenerationMediaSnapshot): void {
  useGenerationDraftStore.getState().patch(snapshot)
}
