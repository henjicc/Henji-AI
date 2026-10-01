import type { AudioEditPlatform } from '@/platform/contracts/audioEdit'
import type { AudioWaveformRangeRequest, AudioWaveformRangeResult } from '@/platform/contracts/audioWaveform'

function api() {
  if (!window.henjiNative?.audio) throw new Error('Audio edit platform is unavailable')
  return window.henjiNative.audio
}

function extractWaveformRange(request: AudioWaveformRangeRequest, signal?: AbortSignal): Promise<AudioWaveformRangeResult> {
  signal?.throwIfAborted()
  const requestId = crypto.randomUUID()
  const native = api()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      action()
    }
    const onAbort = (): void => {
      void native.cancelExtractSamples(requestId).catch(() => undefined)
      finish(() => reject(signal?.reason ?? new DOMException('操作已取消', 'AbortError')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    native.extractRangeSamples({ ...request, requestId }).then(
      (result: AudioWaveformRangeResult) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

export function createElectronAudioEdit(): AudioEditPlatform {
  return {
    listProjects: () => api().listEditProjects(),
    createProject: (request) => api().createEditProject(request),
    getProject: (projectId) => api().getEditProject(projectId),
    saveProject: (project) => api().saveEditProject(project),
    verifySource: (projectId) => api().verifyEditSource(projectId),
    relinkSource: (projectId, sourcePath) => api().relinkEditSource(projectId, sourcePath),
    deleteProject: (projectId) => api().deleteEditProject(projectId),
    detectSilence: (request) => api().detectEditSilence(request),
    listTasks: (projectId) => api().listEditTasks(projectId),
    cancelTask: (requestId) => api().cancelEditTask(requestId),
    prepareProcessing: (projectId, requestId) => api().prepareEditProcessing(projectId, requestId),
    listAsrModels: () => api().listAsrModels(),
    transcribe: (request) => api().transcribeEditProject(request),
    exportProject: (request) => api().exportEditProject(request),
    listProcessors: () => api().listEditProcessors(),
    preparePreviewChunk: (request) => api().prepareEditPreviewChunk(request),
    extractWaveform: (source, bucketCount) => api().extractSamples({ source, bucketCount }),
    extractWaveformRange,
  }
}
