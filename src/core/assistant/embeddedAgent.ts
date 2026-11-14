import { z } from 'zod'
import { applicationRefSchema, truncateCodePoints } from '../application-control/identifiers'
import { agentAttachmentsSchema, type AgentAttachment, type AgentMediaAttachment } from './attachments'
import { HOST_ANNOTATION_PREVIEW_CHARACTERS, type HostContextSnapshot } from '../application-control/hostContracts'

const EMBEDDED_CONTEXT_MAX_CHARACTERS = 16000
type HostAnnotationList = NonNullable<HostContextSnapshot['videoEdit']>['openAnnotations']
function promptAnnotationList(list: HostAnnotationList): HostAnnotationList {
  return { ...list, items: list.items.map(item => ({ ...item,
    text: truncateCodePoints(item.text, HOST_ANNOTATION_PREVIEW_CHARACTERS), ...(item.text.length > HOST_ANNOTATION_PREVIEW_CHARACTERS ? { truncated: true } : {}) })) }
}
/** 高频宿主摘要只含首段；完整选区随独立快照保存，标注正文通过实体读取。 */
export function buildEmbeddedPromptContext(snapshot: HostContextSnapshot): string {
  const context = { documentId: snapshot.documentId, projectId: snapshot.projectId, workspace: snapshot.workspace, canvas: snapshot.canvas,
    surface: snapshot.surface ? { ...snapshot.surface, selectedRefs: [...snapshot.surface.selectedRefs ?? []] } : undefined,
    ...(snapshot.videoEdit ? { videoEdit: { ...snapshot.videoEdit,
      selectedClipRefs: [...snapshot.videoEdit.selectedClipRefs], targetTrackRefs: [...snapshot.videoEdit.targetTrackRefs],
      openAnnotations: promptAnnotationList(snapshot.videoEdit.openAnnotations),
      ...(snapshot.videoEdit.draftAnnotations ? { draftAnnotations: promptAnnotationList(snapshot.videoEdit.draftAnnotations) } : {}),
    } } : {}),
    read: '标注完整正文用 read_application_entity 按 ref 读取；完整选区用 read_assistant_context 按发送时选区引用分页读取。',
    selectionCounts: { selectedRefs: snapshot.surface?.selectedRefs?.length ?? 0,
      selectedClipRefs: snapshot.videoEdit?.selectedClipRefs.length ?? 0, targetTrackRefs: snapshot.videoEdit?.targetTrackRefs.length ?? 0 },
    truncated: false,
  }
  let serialized = JSON.stringify(context)
  for (const items of [context.surface?.selectedRefs, context.videoEdit?.selectedClipRefs, context.videoEdit?.targetTrackRefs, context.videoEdit?.draftAnnotations?.items, context.videoEdit?.openAnnotations.items]) {
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

const embeddedIntentRequestSchema = z.object({
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

/**
 * 内置助手动手前要不要先问：auto 直接做（只守五条底线）；ask 运行命令、写文件、改文件前先问用户；
 * plan 只读取与调查，不做任何修改，最后交出计划。由用户在输入框底栏选，随每条消息发送；助手自己不能改。
 */
export const EMBEDDED_PERMISSION_MODES = ['auto', 'ask', 'plan'] as const
export type EmbeddedPermissionMode = typeof EMBEDDED_PERMISSION_MODES[number]
/** message：拒绝时用户顺手写的一句“应该怎么做”，原样交给助手。 */
export const embeddedApprovalDecisionSchema = z.object({ id: z.string().min(1), decision: z.enum(['allow', 'allow_session', 'deny']), message: z.string().trim().max(2000).optional() }).strict()
export type EmbeddedApprovalDecision = z.infer<typeof embeddedApprovalDecisionSchema>

/** 助手问用户的一道题：2–4 个选项，可多选；用户总能不选而自己写一句。 */
export const embeddedQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  header: z.string().trim().min(1).max(12).optional(),
  multiSelect: z.boolean().optional(),
  options: z.array(z.object({ label: z.string().trim().min(1).max(60), description: z.string().trim().max(200).optional() }).strict()).min(2).max(4),
}).strict()
export type EmbeddedQuestion = z.infer<typeof embeddedQuestionSchema>
/**
 * 用户的回答：answers 与题目一一对应，每题是选中的选项名或自己写的一句；dismissed 表示用户跳过不答。
 * 回答计划时 permissionMode 是用户选的执行方式，给了就从只计划切出去接着执行。
 */
export const embeddedQuestionAnswerSchema = z.object({
  id: z.string().min(1),
  // 每题最多 4 个选项，多选时再加上自己写的一句
  answers: z.array(z.array(z.string().max(2000)).max(5)).max(4),
  dismissed: z.boolean().optional(),
  permissionMode: z.enum(['auto', 'ask']).optional(),
}).strict()
export type EmbeddedQuestionAnswer = z.infer<typeof embeddedQuestionAnswerSchema>

export const embeddedAgentPromptSchema = z.object({
  creativeIntent: embeddedIntentRequestSchema.optional(),
  text: z.string().trim().min(1).max(32000),
  model: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  context: z.string().max(EMBEDDED_CONTEXT_MAX_CHARACTERS),
  selectionSnapshot: embeddedSelectionSnapshotSchema.optional(),
  attachments: agentAttachmentsSchema.optional(),
  /** 助手正在回复时这条消息怎么送：wait 等这轮做完再发；steer 不停下，塞进正在做的事里；interrupt 停掉这轮先处理它。 */
  delivery: z.enum(['wait', 'steer', 'interrupt']).optional(),
  permissionMode: z.enum(EMBEDDED_PERMISSION_MODES).optional(),
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
  memoryNotices?: Array<{ historyId: string; text: string }>
  sendingMessage?: { id: string; text: string; attachments?: AgentAttachment[] }
  pendingMessages?: Array<{ id: string; text: string; attachments?: AgentAttachment[]; error?: string }>
  /** 改前先问模式下等用户点头的那一步：title 是“运行命令”这类动作名，detail 是完整命令或文件路径。 */
  pendingApproval?: { id: string; title: string; detail: string }
  /** 助手在等用户回答的问题；plan 有值时是只计划模式交出的计划，回答里带执行方式。 */
  pendingQuestion?: { id: string; questions: EmbeddedQuestion[]; plan?: string }
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
  decideApproval(input: EmbeddedApprovalDecision): Promise<void>
  answerQuestion(input: EmbeddedQuestionAnswer): Promise<void>
  onSnapshot(handler: (snapshot: EmbeddedAgentSnapshot) => void): () => void
}
export const emptyEmbeddedAgentSnapshot = (): EmbeddedAgentSnapshot => ({ sessionId: null, busy: false, messages: [], activity: null, error: null })
