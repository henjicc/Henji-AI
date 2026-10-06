import type { AudioEditPlatform } from '@/platform/contracts/audioEdit'

function api() {
  if (!window.henjiNative?.audio) throw new Error('Audio edit platform is unavailable')
  return window.henjiNative.audio
}

/** One cancellable `audio:extractSamples` request: an abort cancels this request ID in the main process. */
function cancellable<TRequest extends object, TResult>(call: (payload: TRequest & { requestId: string }) => Promise<TResult>, request: TRequest, signal?: AbortSignal): Promise<TResult> {
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
    call({ ...request, requestId }).then(
      (result: TResult) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

export function createElectronAudioEdit(): AudioEditPlatform {
  return {
    loudness: {
      start: (...args) => api().loudness.start(...args),
      append: (...args) => api().loudness.append(...args),
      measure: (...args) => api().loudness.measure(...args),
      normalize: (...args) => api().loudness.normalize(...args),
      read: (...args) => api().loudness.read(...args),
      close: (...args) => api().loudness.close(...args),
    },
    probeSource: (sourcePath) => api().probeEditSource(sourcePath),
    verifySource: (projectId) => api().verifyEditSource(projectId),
    relinkSource: (projectId, sourcePath) => api().relinkEditSource(projectId, sourcePath),
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
    extractWaveformRange: (request, signal) => cancellable((payload) => api().extractRangeSamples(payload), request, signal),
    extractWaveformPyramid: (request, signal) => cancellable((payload) => api().extractWaveformPyramid(payload), request, signal),
  }
}
