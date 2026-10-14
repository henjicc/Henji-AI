import type { ToolboxToolEntry } from '../../toolboxRuntime'
export default {
  loadComponent: () => import('@/features/screenRecording/ScreenRecordingApp'),
  openRecentFile: async id => { await (await import('@/features/screenRecording/application/recordingService')).showRecordingDocument(id) },
} satisfies ToolboxToolEntry
