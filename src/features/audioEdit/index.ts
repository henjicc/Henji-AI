/** 口播编辑跨功能公开入口；其他功能只从这里取口播文档与识别能力，不伸进内部文件。 */
export { createAudioEditDraft, flushAudioEditProject, loadAudioEditProject, getAudioEditProjectInstance } from './application/audioEditProjectInstances'
export { transcribeAudioEdit, preflightAudioEditTranscription } from './application/audioEditApplicationService'
