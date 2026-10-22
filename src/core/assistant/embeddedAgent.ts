import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { agentAttachmentsSchema, type AgentAttachment, type AgentMediaAttachment } from './attachments'
import { HOST_ANNOTATION_PREVIEW_CHARACTERS, type HostContextSnapshot } from '../application-control/hostContracts'

export const EMBEDDED_CONTEXT_MAX_CHARACTERS = 16000
/** 高频宿主摘要只含首段；完整选区随独立快照保存，标注正文通过实体读取。 */
export function buildEmbeddedPromptContext(snapshot: HostContextSnapshot): string {
  const context = { workspace: snapshot.workspace, canvas: snapshot.canvas,
    surface: snapshot.surface ? { ...snapshot.surface, selectedRefs: [...snapshot.surface.selectedRefs ?? []] } : undefined,
    ...(snapshot.videoEdit ? { videoEdit: { ...snapshot.videoEdit,
      selectedClipRefs: [...snapshot.videoEdit.selectedClipRefs], targetTrackRefs: [...snapshot.videoEdit.targetTrackRefs],
      openAnnotations: { ...snapshot.videoEdit.openAnnotations, items: snapshot.videoEdit.openAnnotations.items.map(item => ({ ...item,
        text: item.text.slice(0, HOST_ANNOTATION_PREVIEW_CHARACTERS), ...(item.text.length > HOST_ANNOTATION_PREVIEW_CHARACTERS ? { truncated: true } : {}) })) },
    } } : {}),
    read: '标注完整正文用 read_application_entity 按 ref 读取；完整选区用 read_assistant_context 按发送时选区引用分页读取。',
    selectionCounts: { selectedRefs: snapshot.surface?.selectedRefs?.length ?? 0,
      selectedClipRefs: snapshot.videoEdit?.selectedClipRefs.length ?? 0, targetTrackRefs: snapshot.videoEdit?.targetTrackRefs.length ?? 0 },
    truncated: false,
  }
  let serialized = JSON.stringify(context)
  for (const items of [context.surface?.selectedRefs, context.videoEdit?.selectedClipRefs, context.videoEdit?.targetTrackRefs, context.videoEdit?.openAnnotations.items]) {
    while (serialized.length > EMBEDDED_CONTEXT_MAX_CHARACTERS && items?.length) {
      items.pop(); context.truncated = true; serialized = JSON.stringify(context)
    }
  }
  if (serialized.length > EMBEDDED_CONTEXT_MAX_CHARACTERS && context.videoEdit) {
    delete context.videoEdit.selectedCodeElement; delete context.videoEdit.elementOverrides; delete context.videoEdit.currentStyle; delete context.videoEdit.presetPreferences
    context.truncated = true; serialized = JSON.stringify(context)
  }
  if (serialized.length > EMBEDDED_CONTEXT_MAX_CHARACTERS) throw new Error('当前界面摘要过长，请缩小选区后重试。')
  return serialized
}

/** 界面与执行边界共用真实传输支持的输入模态。 */
export function embeddedInputModalities(capabilities: Partial<Record<AgentMediaAttachment['modality'], boolean>>, api: string): AgentMediaAttachment['modality'][] {
  return (['image', 'video', 'audio'] as const).filter(type => capabilities[type] && !(api === 'openai-responses' && type === 'audio'))
}

export const embeddedIntentRequestSchema = z.object({
  documentRef: applicationRefSchema.extend({ kind: z.enum(['video_edit.document', 'image_edit.document']) }),
  sessionId: z.string().min(1),
  draftRefs: z.array(applicationRefSchema.extend({ kind: z.enum(['video_edit.intent_draft', 'image_edit.intent_draft']) })).min(1),
}).strict()
export type EmbeddedIntentRequest = z.infer<typeof embeddedIntentRequestSchema>

/** 发送瞬间的完整选区，仅作会话数据；分页预算不限制用户选择数量。 */
export const embeddedSelectionSnapshotSchema = z.object({
  capturedAt: z.string(),
  selectedRefs: z.array(z.string()),
  selectedClipRefs: z.array(z.string()),
  targetTrackRefs: z.array(z.string()),
}).strict()
export type EmbeddedSelectionSnapshot = z.infer<typeof embeddedSelectionSnapshotSchema>

export const embeddedAgentPromptSchema = z.object({
  creativeIntent: embeddedIntentRequestSchema.optional(),
  text: z.string().trim().min(1).max(32000),
  model: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  access: z.enum(['read', 'write', 'full']),
  context: z.string().max(EMBEDDED_CONTEXT_MAX_CHARACTERS),
  selectionSnapshot: embeddedSelectionSnapshotSchema.optional(),
  attachments: agentAttachmentsSchema.optional(),
  delivery: z.enum(['wait', 'interrupt']).optional(),
  clientMessageId: z.string().uuid().optional(),
}).strict()
export type EmbeddedAgentPrompt = z.infer<typeof embeddedAgentPromptSchema>
export interface EmbeddedAgentMessage { id: string; role: 'user' | 'assistant'; text: string; attachments?: AgentAttachment[]; kind?: 'process' | 'answer' | 'tool'; status?: 'running' | 'completed' | 'failed' }
export interface EmbeddedAgentSnapshot {
  sessionId: string | null
  busy: boolean
  /** 正在切换对话（打开、新建、列出对话）：busy 同时为 true；此时发送的消息排队，切换完成后发送。 */
  switching?: boolean
  messages: EmbeddedAgentMessage[]
  activity: string | null
  error: string | null
  sendingMessage?: { id: string; text: string; attachments?: AgentAttachment[] }
  pendingMessages?: Array<{ id: string; text: string; attachments?: AgentAttachment[]; error?: string }>
}
export interface EmbeddedAgentSession { id: string; title: string; updatedAt: string }
export interface EmbeddedAgentModel { providerId: string; modelId: string; name: string; inputModalities: AgentMediaAttachment['modality'][] }
export interface EmbeddedAgentPlatform {
  snapshot(): Promise<EmbeddedAgentSnapshot>
  models(): Promise<EmbeddedAgentModel[]>
  prompt(input: EmbeddedAgentPrompt): Promise<void>
  cancel(): Promise<void>
  newSession(): Promise<void>
  sessions(): Promise<EmbeddedAgentSession[]>
  openSession(id: string): Promise<void>
  onSnapshot(handler: (snapshot: EmbeddedAgentSnapshot) => void): () => void
}
export const emptyEmbeddedAgentSnapshot = (): EmbeddedAgentSnapshot => ({ sessionId: null, busy: false, messages: [], activity: null, error: null })
