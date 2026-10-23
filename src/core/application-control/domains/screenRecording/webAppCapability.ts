import { z } from 'zod'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

export const webAppRefSchema = z.object({ kind: z.literal('screen_recording.web_app'), id: z.string().uuid() }).strict()
export const webRecordingRefSchema = z.object({ kind: z.literal('screen_recording.web_recording'), id: z.string().uuid() }).strict()

// Web recordings keep everything the app saw, credentials included; the user chose full visibility for the assistant.
const common = { version: 1, domain: 'screen_recording', readOnly: false, risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'screen_recording:write', idempotent: false, destructive: false,
  timeoutMs: 120000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording.web' }

export const startWebAppRecordingCapability = defineApplicationCapability({ ...common,
  id: 'start_web_app_recording', title: '开始录制网页应用',
  description: '录制已接入痕迹探针的网页应用（Tauri、Electron 或网页）：应用会重新加载并从启动开始记录网络请求、宿主调用、随机数、页面存储和鼠标键盘操作，请求照常发出。先列出 screen_recording.web_app 选择应用。录制内容原样保存，包括密钥。',
  aliases: ['录制网页应用', '录制知多少', 'web app recording', '应用重演录制'],
  inputSchema: z.object({ appRef: webAppRefSchema }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_app'], producesRefs: ['screen_recording.web_recording'],
  resolveOperationTargets: input => [input.appRef],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'screen_recording.web_recording', id: `pending:${operationId}` }],
  control: capabilityControl('create', ['screen_recording.web_recording']),
  summarize: () => '网页应用已重新加载并开始录制。',
})

export const stopWebAppRecordingCapability = defineApplicationCapability({ ...common,
  id: 'stop_web_app_recording', title: '停止网页应用录制',
  description: '停止录制并等待应用交回前端资源，写成可离线重演的录制文件。返回状态与录制时发现的漏网调用提醒。',
  aliases: ['停止网页录制'],
  inputSchema: z.object({ recordingRef: webRecordingRefSchema }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, status: z.enum(['complete', 'interrupted']), durationMs: z.number().nonnegative(), warnings: z.array(z.string()), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_recording'], producesRefs: ['screen_recording.web_recording'],
  resolveOperationTargets: input => [input.recordingRef],
  control: capabilityControl('execute', ['screen_recording.web_recording']),
  summarize: result => `网页录制已保存（${result.status === 'complete' ? '完整' : '中断'}，${Math.round(result.durationMs / 1000)} 秒）。`,
})

export const readWebAppRecordingCapability = defineApplicationCapability({ ...common,
  id: 'read_web_app_recording', title: '读取网页应用录制',
  description: '分页读取网页录制的数据轨（网络请求与返回、宿主调用、外部资源）或行为轨（鼠标、键盘、输入文字、粘贴拖入、应用动作），内容完整未脱敏。offset 从 0 开始，按 nextOffset 续读。',
  aliases: ['读网页录制', '查看录制请求'], readOnly: true, risk: 'R0', permission: 'screen_recording:read', idempotent: true,
  inputSchema: z.object({ recordingRef: webRecordingRefSchema, track: z.enum(['data', 'behavior']), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  outputSchema: capabilityOutputSchema({ entries: z.array(z.unknown()), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() }),
  acceptsRefs: ['screen_recording.web_recording'], control: capabilityControl('observe', ['screen_recording.web_recording']),
  summarize: result => `已读取 ${result.entries.length} / ${result.total} 条。`,
})

export const renderWebAppReplayCapability = defineApplicationCapability({ ...common,
  id: 'render_web_app_replay', title: '重演网页录制并出视频',
  description: '不联网、不启动原应用，在痕迹内用录制的前端资源重新运行界面，按录制的操作和数据重演，逐帧编码成 MP4。返回视频的本机路径与重演中发现的冲突（录制里没有的请求、缺失资源等）。',
  aliases: ['网页重演', '重演录制', 'replay web recording'], timeoutMs: 600000,
  inputSchema: z.object({ recordingRef: webRecordingRefSchema, fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30) }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, video: z.string(), width: z.number().int(), height: z.number().int(), frames: z.number().int(), conflicts: z.array(z.string()), warnings: z.array(z.string()), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_recording'], producesRefs: ['screen_recording.web_recording'],
  resolveOperationTargets: input => [input.recordingRef],
  control: capabilityControl('execute', ['screen_recording.web_recording'], { cancelable: true }),
  summarize: result => `重演完成：${result.frames} 帧，${result.conflicts.length} 处冲突。`,
})

export const WEB_APP_RECORDING_CAPABILITIES = [startWebAppRecordingCapability, stopWebAppRecordingCapability, readWebAppRecordingCapability, renderWebAppReplayCapability]
