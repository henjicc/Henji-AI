import { z } from 'zod'
import { videoEditSequenceDefaultsSchema } from '../videoEdit/sequenceDefaults'
import { DEFAULT_RECORDING_SHORTCUTS, recordingShortcutsSchema } from '../screenRecording/contracts'

export const SETTINGS_STORAGE_VERSION = 14

/** 13 → 14：只补新增录制快捷键；已有设置与扩展字段原样保留。 */
export function migrateSettingsV13(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const record = content as Record<string, unknown>
  return { ...record, recordingShortcuts: record.recordingShortcuts === undefined ? { ...DEFAULT_RECORDING_SHORTCUTS } : record.recordingShortcuts }
}

// Existing merge normalizes partial settings; this schema describes accepted persisted fields.
export const rendererSettingsSchema = z.object({
  recordingShortcuts: recordingShortcutsSchema.optional(),
  providerKeyStatus: z.record(z.string(), z.boolean()).optional(), uploadProvider: z.string().optional(), uploadFallbackEnabled: z.boolean().optional(),
  largeUploadStrategy: z.enum(['ask', 'copy', 'reference']).optional(), downloadPresetPaths: z.array(z.string()).optional(),
  ...Object.fromEntries(['useUploadFilenameAsNodeTitle', 'enableImageViewerInfoPanel', 'imageViewerInfoPanelCollapsed', 'storyboardGenKeepStyleConsistent', 'storyboardGenDisableTextInImage', 'storyboardGenAutoInferEmptyFrame', 'ignoreAtTagWhenCopyingAndGenerating', 'autoInsertTextDisplayNode', 'uiBlurEnabled', 'assetEdgeTriggerEnabled', 'videoEditSelectionFollowsPlayhead', 'videoEditBinsFirst', 'videoEditImportFolderBins'].map(key => [key, z.boolean().optional()])),
  canvasLodLevel: z.enum(['off', 'detail', 'balanced', 'performance']).optional(), uiScaleMode: z.string().optional(), uiRadiusPreset: z.string().optional(),
  themeSelection: z.record(z.string(), z.json()).optional(), themeSeed: z.record(z.string(), z.json()).optional(), themeOverrides: z.record(z.string(), z.json()).optional(),
  startupWorkspace: z.string().optional(), assetTabAction: z.enum(['floating', 'workspace']).optional(), assetPanelPosition: z.enum(['top', 'left', 'right']).optional(),
  assetTriggerEdge: z.enum(['left', 'right']).optional(), assetEdgeDelayMs: z.number().optional(), assetDragEdgeDelayMs: z.number().optional(), assetCardSize: z.number().optional(), assetThumbnailFit: z.enum(['cover', 'contain']).optional(),
  videoEditSequenceDefaults: videoEditSequenceDefaultsSchema.optional(), videoEditShortcuts: z.record(z.string(), z.json()).optional(),
  videoEditMonitorButtons: z.record(z.string(), z.json()).optional(), videoEditTrackHeaderButtons: z.record(z.string(), z.json()).optional(),
  videoEditDefaultTransitions: z.record(z.string(), z.json()).optional(), videoEditDuplicatePolicy: z.enum(['skip', 'import']).optional(),
}).passthrough()
