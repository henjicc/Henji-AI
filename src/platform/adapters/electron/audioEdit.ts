import type { AudioEditPlatform } from '@/platform/contracts/audioEdit'

function api() {
  if (!window.henjiNative?.audio) throw new Error('Audio edit platform is unavailable')
  return window.henjiNative.audio
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
  }
}
