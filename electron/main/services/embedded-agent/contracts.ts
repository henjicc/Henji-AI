import type { LlmModelConfig, LlmReasoningConfig } from '@henjicc/ai-sdk'
import type { EmbeddedAgentSnapshot, EmbeddedIntentRequest, EmbeddedPermissionMode, EmbeddedQuestion, EmbeddedSelectionSnapshot } from '../../../../src/core/assistant/embeddedAgent'
import type { AgentAttachment } from '../../../../src/core/assistant/attachments'
export interface PreparedEmbeddedAttachment { attachment: AgentAttachment; data: string }
/** annotations.readOnlyHint：只读的应用工具，只计划模式下照常可用。 */
export interface EmbeddedTool { name: string; title?: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }
export interface EmbeddedModel { providerId: string; model: LlmModelConfig; baseUrl: string; api: 'openai-completions' | 'openai-responses' | 'anthropic-messages'; apiKey: string; reasoning?: LlmReasoningConfig }
/**
 * workFolder：本机命令与文件工具的工作文件夹（当前项目，或作品目录），也是读取项目规则文件与项目助手插件的位置。
 * projectTrusted：为假时不加载工作文件夹里的助手插件与设置（别人分享来的项目，用户还没允许运行其中代码）。
 */
export interface EngineConfiguration { directory: string; workFolder: string; projectTrusted: boolean; permissionMode: EmbeddedPermissionMode; model: EmbeddedModel; tools: EmbeddedTool[]; instructions: string }
export type EngineCommand =
  | { action: 'initialize'; input: string }
  | { action: 'configure'; input: EngineConfiguration }
  | { action: 'prompt'; input: { text: string; context: string; background?: boolean; selectionSnapshot?: EmbeddedSelectionSnapshot; requestId?: string; creativeIntent?: EmbeddedIntentRequest; attachments?: PreparedEmbeddedAttachment[] } }
  | { action: 'open'; input: string }
  /** 助手正在回复时插入一句话：不停下，下一步就能看到。 */
  | { action: 'steer'; input: string }
  | { action: 'snapshot' | 'cancel' | 'new' | 'sessions'; input?: never }
export type EngineEvent =
  | { type: 'snapshot'; value: EmbeddedAgentSnapshot }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'toolCancel'; id: string }
  /** 本机命令可能长时间没有输出（安装依赖、下载模型）：运行期间定时发出，宿主据此判断助手仍在工作。 */
  | { type: 'heartbeat' }
  /** 改前先问模式下等用户确认的一步；宿主把用户的回答以 approvalResult 消息送回。 */
  | { type: 'approval'; id: string; title: string; detail: string }
  /** 助手调 ask_user / present_plan 等用户回答；宿主把回答以 questionResult 消息送回。 */
  | { type: 'question'; id: string; questions: EmbeddedQuestion[]; plan?: string }
  | { type: 'log'; phase: 'start' | 'completed' | 'failed' | 'cancelled' | 'model_requested' | 'model_completed' | 'usage_summary' | 'tool_executed' | 'extension_failed'; sessionId: string | null; requestId: string; message?: string;
      requestMetrics?: { toolCount: number; toolBytes: number; systemBytes: number; messageCount: number; contextCount: number; contextBytes: number };
      summary?: { requests: number; usageResponses: number; input: number; output: number; cacheRead: number; cacheWrite: number; cacheHitRate: number | null; reasoning: number;
        /** 首个流式增量的平均与最慢等待（毫秒）；费用按 embeddedModelPricing 的参考单价计，没有单价时不出现。 */
        firstTokenMsAverage?: number; firstTokenMsMax?: number; cost?: number; costCurrency?: 'CNY' | 'USD';
        toolResults: number; toolTextBytes: number; largestToolTextBytes: number; toolTextByName: Record<string, { calls: number; bytes: number; maxBytes: number }> };
      turn?: number; stopReason?: string; answer?: string;
      /** Pi 层的每次工具执行，含 Pi 自己处理或拒绝、没有交给应用的调用（未加载的工具、参数不合格、本地读取工具）。 */
      tool?: { toolCallId: string; toolName: string; args: unknown; isError: boolean; durationMs?: number; resultText?: string };
      durationMs?: number; modelId?: string; providerId?: string; metrics?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cacheHitRate?: number | null; reasoning?: number; firstTokenMs?: number; cost?: number; costCurrency?: 'CNY' | 'USD' } }
export interface EmbeddedAgentEngine {
  command(command: EngineCommand): Promise<unknown>
  dispose(): Promise<void>
}
