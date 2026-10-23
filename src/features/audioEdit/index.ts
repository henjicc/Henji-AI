/** 音频编辑跨功能公开入口；文字、区域编辑与剪辑链接共用文档实例。 */
export { createAudioEditDraft, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, getAudioEditProjectInstance, subscribeAudioEditInstances } from './application/audioEditProjectInstances'
export { transcribeAudioEdit, preflightAudioEditTranscription } from './application/audioEditApplicationService'
export { setAudioEditRegions, renderAudioEdit, repairAudioEditRegion } from './application/audioEditRegions'
export { importAudioEditMedia, openAudioEditDocument } from './application/audioEditDocumentService'
