import { z } from 'zod'
import { videoEditExportSettingsSchema } from './exportPresets'

export const videoEditExportMemoryEntrySchema = z.object({
  projectId: z.string().min(1), sequenceId: z.string().min(1), presetId: z.string().min(1),
  settings: videoEditExportSettingsSchema, directory: z.string(), fileName: z.string().min(1),
  requestedFileName: z.string().min(1).optional().describe('用户在导出窗口填写的文件名；fileName 是实际落盘名，可能带自动补上的编号。'),
  loudnessRequested: z.boolean().optional().describe('用户是否明确要求响度标准化；缺省时由预设推算。'),
  range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().refine(value => value.endFrame > value.startFrame, '出点必须晚于入点。'),
  rangeSource: z.enum(['explicit', 'in-out', 'content']), completedAt: z.number().nonnegative(),
}).strict()
export const videoEditExportMemorySchema = z.array(videoEditExportMemoryEntrySchema)
export type VideoEditExportMemoryEntry = z.infer<typeof videoEditExportMemoryEntrySchema>
