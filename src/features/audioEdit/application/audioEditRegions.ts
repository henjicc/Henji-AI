import type { AudioEditGainRegion, AudioEditRepair, AudioEditRenderedAudio, AudioEditSpectrogramChunk, AudioEditSpectrogramRequest } from '@/core/audioEdit/regions'
import { audioEditGainRegionsSchema, audioEditRepairsSchema } from '@/core/audioEdit/regions'
import { getPlatform } from '@/platform/runtime'
import type { AudioEditSpectralTileRequest, AudioEditSpectralTile, AudioEditSpectralProgress } from '@/core/audioEdit/spectralPyramid'
import { editAudioEditProject, flushAudioEditProject, loadAudioEditProject, withAudioEditProjectOperation } from './audioEditProjectInstances'

/** Same instance/history as text editing. Omitted collections remain unchanged. */
export async function setAudioEditRegions(projectId: string, regions: { gainRegions?: AudioEditGainRegion[]; repairs?: AudioEditRepair[] }, expectedVersion?: number): Promise<void> {
  const instance = await loadAudioEditProject(projectId)
  const gainRegions = regions.gainRegions === undefined ? undefined : audioEditGainRegionsSchema.parse(regions.gainRegions)
  const repairs = regions.repairs === undefined ? undefined : audioEditRepairsSchema.parse(regions.repairs)
  if (expectedVersion !== undefined && instance.version !== expectedVersion) throw new Error('音频已发生变化，请重新读取后再修改')
  editAudioEditProject(projectId, document => ({ ...document, ...(gainRegions === undefined ? {} : { gainRegions }), ...(repairs === undefined ? {} : { repairs }) }))
  await flushAudioEditProject(projectId)
}
export async function getAudioEditSpectrogram(request: AudioEditSpectrogramRequest): Promise<AudioEditSpectrogramChunk> {
  await loadAudioEditProject(request.projectId)
  await flushAudioEditProject(request.projectId)
  return getPlatform().audioEdit.spectrogram(request)
}
const spectralRequests = new Map<string, { cancelled: boolean }>()
export async function getAudioEditSpectralTile(request: AudioEditSpectralTileRequest): Promise<AudioEditSpectralTile> {
  if (spectralRequests.has(request.requestId)) throw new Error('频谱请求 ID 已在使用')
  const state = { cancelled: false }
  spectralRequests.set(request.requestId, state)
  try {
    await loadAudioEditProject(request.projectId)
    await flushAudioEditProject(request.projectId)
    if (state.cancelled) throw new Error('频谱读取已取消')
    return await getPlatform().audioEdit.spectralTile(request)
  } finally { spectralRequests.delete(request.requestId) }
}
export function cancelAudioEditSpectralTile(requestId: string): Promise<void> {
  const state = spectralRequests.get(requestId)
  if (state) state.cancelled = true
  return getPlatform().audioEdit.spectralCancel(requestId)
}
export function subscribeAudioEditSpectralProgress(handler: (progress: AudioEditSpectralProgress) => void): () => void {
  return getPlatform().audioEdit.onSpectralProgress(handler)
}
export async function renderAudioEdit(projectId: string, requestId: string = crypto.randomUUID(), includeProcessing?: boolean): Promise<AudioEditRenderedAudio> {
  return withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.render({ projectId, requestId, includeProcessing }))
}
/** Algorithm action. The persisted record remains undoable even if rendering fails; retry does not recreate it. */
export async function repairAudioEditRegion(projectId: string, repair: AudioEditRepair, requestId: string = crypto.randomUUID()): Promise<AudioEditRenderedAudio> {
  const instance = await loadAudioEditProject(projectId)
  if (instance.document.repairs?.some(r => r.id === repair.id)) throw new Error('该修复引用已存在，请修改已有修复或使用新的引用')
  await setAudioEditRegions(projectId, { repairs: [...instance.document.repairs ?? [], repair] }, instance.version)
  return renderAudioEdit(projectId, requestId)
}
