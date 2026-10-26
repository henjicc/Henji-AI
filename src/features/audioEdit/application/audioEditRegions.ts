import type { AudioEditGainRegion, AudioEditRepair, AudioEditRenderedAudio } from '@/core/audioEdit/regions'
import { audioEditGainRegionsSchema, audioEditRepairsSchema } from '@/core/audioEdit/regions'
import { getPlatform } from '@/platform/runtime'
import type { AudioEditSpectralTileRequest, AudioEditSpectralTile, AudioEditSpectralProgress } from '@/core/audioEdit/spectralPyramid'
import { editAudioEditProject, flushAudioEditProject, getAudioEditProjectInstance, loadAudioEditProject, withAudioEditProjectOperation, type AudioEditProjectInstance } from './audioEditProjectInstances'

/** Same instance/history as text editing. Omitted collections remain unchanged. */
export async function setAudioEditRegions(projectId: string, regions: { gainRegions?: AudioEditGainRegion[]; repairs?: AudioEditRepair[] }, expectedVersion?: number): Promise<void> {
  const instance = await loadAudioEditProject(projectId)
  const gainRegions = regions.gainRegions === undefined ? undefined : audioEditGainRegionsSchema.parse(regions.gainRegions)
  const repairs = regions.repairs === undefined ? undefined : audioEditRepairsSchema.parse(regions.repairs)
  if (expectedVersion !== undefined && instance.version !== expectedVersion) throw new Error('音频已发生变化，请重新读取后再修改')
  editAudioEditProject(projectId, document => ({ ...document, ...(gainRegions === undefined ? {} : { gainRegions }), ...(repairs === undefined ? {} : { repairs }) }))
  await flushAudioEditProject(projectId)
}
/** 波形显示的“已编辑、未删除”音频：先保存当前修改，主进程按文件里的作品处理，拿到的才是这次改完的声音。 */
export async function getAudioEditEditedSource(projectId: string): Promise<{ audioPath: string }> {
  await loadAudioEditProject(projectId)
  await flushAudioEditProject(projectId)
  return getPlatform().audioEdit.editedSource({ projectId })
}

/*
 * 宿主给剪后频谱块与整段进度标的是文件版本（每保存一次加一）；显示端判断“是不是改声音之后算的”用内存里的作品版本
 * （每改一次加一）。自动保存会把连着的几次修改合成一次写入，内存版本因此跑在文件版本前面，两者不能直接比：
 * 直接比会把新声音的块全当成过期丢掉，频谱一直停在改声音之前读到的那几块（放大、平移后只剩粗一层）。
 * 取块前的保存屏障记下“保存完成时的文件版本 → 保存前的内存版本”，宿主回来的文件版本按它换算：取不晚于这个文件版本的
 * 记录里最大的内存版本（文件里至少有那时的修改）；没有记录的算作更早（-1）。按实例记：重新打开后内存版本从文件版本重新数起。
 */
const savedRevisions = new WeakMap<AudioEditProjectInstance, Array<{ file: number; memory: number }>>()
function rememberSavedRevision(instance: AudioEditProjectInstance, file: number, memory: number): void {
  const list = savedRevisions.get(instance) ?? []
  const last = list.at(-1)
  if (last && last.file >= file) last.memory = Math.max(last.memory, memory)
  else list.push({ file, memory })
  if (list.length > 64) list.splice(0, list.length - 64)
  savedRevisions.set(instance, list)
}
/** 宿主标的文件版本换算成显示端用的内存版本（见上）。 */
export function audioEditMemoryRevision(projectId: string, fileRevision: number): number {
  const instance = getAudioEditProjectInstance(projectId)
  let memory = -1
  for (const entry of (instance && savedRevisions.get(instance)) || []) {
    if (entry.file > fileRevision) break
    memory = Math.max(memory, entry.memory)
  }
  return memory
}

const spectralRequests = new Map<string, { cancelled: boolean }>()
export async function getAudioEditSpectralTile(request: AudioEditSpectralTileRequest): Promise<AudioEditSpectralTile> {
  if (spectralRequests.has(request.requestId)) throw new Error('频谱请求 ID 已在使用')
  const state = { cancelled: false }
  spectralRequests.set(request.requestId, state)
  try {
    const instance = await loadAudioEditProject(request.projectId)
    const memory = instance.document.revision
    await flushAudioEditProject(request.projectId)
    if (state.cancelled) throw new Error('频谱读取已取消')
    if (request.mode === 'edited' && getAudioEditProjectInstance(request.projectId) === instance) rememberSavedRevision(instance, instance.persistedRevision, memory)
    const tile = await getPlatform().audioEdit.spectralTile(request)
    return tile.mode === 'edited' ? { ...tile, revision: audioEditMemoryRevision(request.projectId, tile.revision) } : tile
  } finally { spectralRequests.delete(request.requestId) }
}
export function cancelAudioEditSpectralTile(requestId: string): Promise<void> {
  const state = spectralRequests.get(requestId)
  if (state) state.cancelled = true
  return getPlatform().audioEdit.spectralCancel(requestId)
}
export function subscribeAudioEditSpectralProgress(handler: (progress: AudioEditSpectralProgress) => void): () => void {
  return getPlatform().audioEdit.onSpectralProgress(progress => handler(progress.mode === 'edited' ? { ...progress, revision: audioEditMemoryRevision(progress.projectId, progress.revision) } : progress))
}
export async function renderAudioEdit(projectId: string, requestId: string = crypto.randomUUID()): Promise<AudioEditRenderedAudio> {
  return withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.render({ projectId, requestId }))
}
/** Algorithm action. The persisted record remains undoable even if rendering fails; retry does not recreate it. */
export async function repairAudioEditRegion(projectId: string, repair: AudioEditRepair, requestId: string = crypto.randomUUID()): Promise<AudioEditRenderedAudio> {
  const instance = await loadAudioEditProject(projectId)
  if (instance.document.repairs?.some(r => r.id === repair.id)) throw new Error('该修复引用已存在，请修改已有修复或使用新的引用')
  await setAudioEditRegions(projectId, { repairs: [...instance.document.repairs ?? [], repair] }, instance.version)
  return renderAudioEdit(projectId, requestId)
}
/** 频谱金字塔取块的唯一入口，供显示端调度器注入。 */
export const audioEditSpectralClient = {
  fetch: getAudioEditSpectralTile,
  cancel: (requestId: string): void => { void cancelAudioEditSpectralTile(requestId).catch(() => undefined) },
  subscribe: subscribeAudioEditSpectralProgress,
}
