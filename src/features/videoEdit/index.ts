/** Shared encoding policy for export and live capture. */
export { selectVideoEditExportEncoder, videoEditExportVideoOptions } from './engine/videoEditExportEncoder'
export { videoEditExportVideoEncoderConfig } from './engine/videoEditExportEncoderConfig'
export { importVideoEditSources } from './application/videoEditMedia'
export { openVideoEditDocument, saveVideoEdit, holdVideoEditActivity, createVideoEditProject, appendVideoEditSequence, switchVideoEditSequence } from './application/videoEditService'
export { requireVideoEditInstance, verifyVideoEditSaved } from './application/videoEditService'
export { analyzeVideoEditScreenAttentionOffThread } from './application/videoEditScreenAttentionWorkerClient'
export { prepareVideoEditAudioGain } from './application/videoEditLoudness'
