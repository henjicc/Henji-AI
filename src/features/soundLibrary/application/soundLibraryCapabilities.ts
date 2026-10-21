import type { z } from 'zod'
import { addSoundLibraryFolderCapability, searchSoundEffectsCapability } from '@/core/application-control/domains/soundLibrary/soundLibraryCapabilities'
import { soundBrightnessLabel } from '@/core/soundLibrary/soundFeatures'
import { addSoundLibraryFolder, getSoundLibraryState, searchSoundLibrary } from '@/commands/soundLibrary'
import type { CapabilityExecutionContext } from '@/features/application-control'
import type { SoundLibrarySearchResponse } from '@/platform/contracts/soundLibrary'

/** 登记与设置页“添加文件夹”同一入口：主进程弹出选择框，渲染层不经手路径。 */
export async function addSoundLibraryFolderFromCapability(raw: unknown, context: CapabilityExecutionContext): Promise<z.infer<typeof addSoundLibraryFolderCapability.outputSchema>> {
  addSoundLibraryFolderCapability.inputSchema.parse(raw)
  const before = await getSoundLibraryState()
  context.signal?.throwIfAborted()
  const folder = await addSoundLibraryFolder()
  if (!folder) return { status: 'cancelled', message: '用户取消了选择，没有登记文件夹。', verification: { verified: true, condition: '选择框已取消，登记表未改变。' } }
  const after = await getSoundLibraryState()
  const added = !before.folders.some(value => value.id === folder.id)
  const verified = after.folders.some(value => value.id === folder.id)
  return {
    status: added ? 'added' : 'already_registered', resultRef: { kind: 'sound_library.folder', id: folder.id }, folderStatus: folder.status,
    message: added ? `已登记音效文件夹“${folder.name}”，正在后台整理；检索时会自动等待整理完成。` : `“${folder.name}”已经登记过，沿用原文件夹。`,
    verification: { verified, condition: verified ? '已从音效库服务回读，文件夹在登记表里。' : '回读登记表没有这个文件夹。' },
  }
}

function message(result: SoundLibrarySearchResponse): string {
  const listening = { used: '已结合听音', no_description: '只按名字（没有给英文描述）', model_not_downloaded: '只按名字（听音模型未下载）', partial: '部分音效尚无听音向量，那部分只按名字' }[result.listening]
  if (result.noGoodMatch) return `没有合适的音效（在 ${result.indexedSounds} 个音效里${listening}检索）。下面列出的只是最接近的，请如实告诉用户。`
  return `找到 ${result.matches.length} 个候选（${result.indexedSounds} 个音效，${listening}）。卡点时把 hitSeconds 对齐到目标时刻。`
}

export async function searchSoundEffectsFromCapability(raw: unknown, context: CapabilityExecutionContext): Promise<z.infer<typeof searchSoundEffectsCapability.outputSchema>> {
  const input = searchSoundEffectsCapability.inputSchema.parse(raw)
  context.signal?.throwIfAborted()
  const result = await searchSoundLibrary({
    keywords: input.keywords, ...(input.description ? { description: input.description } : {}), ...(input.folderRefs ? { folderIds: input.folderRefs.map(ref => ref.id) } : {}),
    minDurationSeconds: input.minDurationSeconds, maxDurationSeconds: input.maxDurationSeconds, maxHitSeconds: input.maxHitSeconds, brightness: input.brightness, limit: input.limit,
  })
  return {
    matches: result.matches.map(match => ({
      soundRef: { kind: 'sound_library.sound', id: match.id }, folderRef: { kind: 'sound_library.folder', id: match.folderId },
      name: match.label, englishName: match.english, chineseName: match.chinese, relativePath: match.relativePath,
      durationSeconds: round(match.durationSeconds), attackSeconds: round(match.attackSeconds), hitSeconds: round(match.hitSeconds),
      peakDbfs: match.peakDbfs === null ? null : round(match.peakDbfs, 1), loudnessLufs: match.loudnessLufs === null ? null : round(match.loudnessLufs, 1), brightness: soundBrightnessLabel(match.brightnessHz),
      score: round(match.score), matchedBy: match.matchedBy,
    })),
    noGoodMatch: result.noGoodMatch, listening: result.listening, considered: result.considered, indexedSounds: result.indexedSounds, skippedFiles: result.skippedFiles, message: message(result),
  }
}

function round(value: number, digits = 3): number { return Math.round(value * 10 ** digits) / 10 ** digits }
