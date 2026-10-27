import { z } from 'zod'
import { boxSelectorsSchema, boxTrackQueryShape, validBoxTimeRange } from '../../../webReplay/boxTrackQuery'
import { capabilityControl, capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'

export const webAppRefSchema = z.object({ kind: z.literal('screen_recording.web_app'), id: z.string().uuid() }).strict()
export const webRecordingRefSchema = z.object({ kind: z.literal('screen_recording.web_recording'), id: z.string().uuid() }).strict()

// Web recordings keep everything the app saw, credentials included; the user chose full visibility for the assistant.
const common = { version: 1, domain: 'screen_recording', readOnly: false, risk: 'R1' as const, dataClasses: ['C1' as const], permission: 'screen_recording:write', idempotent: false, destructive: false,
  timeoutMs: 120000, supportsPreview: false, supportsUndo: false, requiredScopes: [], concurrencyKey: 'screen_recording.web' }

export const startWebAppRecordingCapability = defineApplicationCapability({ ...common,
  id: 'start_web_app_recording', title: '开始录制网页应用',
  description: '实验性功能，需先开启设置属性 experimental.web_app_recording。录制已接入痕迹探针的网页应用（Tauri、Electron 或网页）：应用会重新加载并从启动开始记录网络请求、宿主调用、随机数、页面存储和鼠标键盘操作，请求照常发出。先列出 screen_recording.web_app 选择应用。录制内容原样保存，包括密钥。同时按录屏页「备份录屏」的设置（应用窗口或整个屏幕、帧率、清晰度）录一份普通屏幕视频。',
  aliases: ['录制网页应用', '录制知多少', 'web app recording', '应用重演录制'],
  inputSchema: z.object({
    appRef: webAppRefSchema,
    projectId: z.string().min(1).max(200).optional().describe('可选：存进这个项目（documents.project 的 ID），写成 素材/录屏/<名称>.hjweb 网页录制文档；不给时存在应用数据里'),
    name: z.string().trim().min(1).max(120).optional().describe('可选：录制名称，也是项目里的文件夹名；不给时用“应用名 日期 时间”'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, directory: z.string(), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_app'], producesRefs: ['screen_recording.web_recording'],
  resolveOperationTargets: input => [input.appRef],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'screen_recording.web_recording', id: `pending:${operationId}` }],
  control: capabilityControl('create', ['screen_recording.web_recording']),
  summarize: () => '网页应用已重新加载并开始录制。',
})

export const stopWebAppRecordingCapability = defineApplicationCapability({ ...common,
  id: 'stop_web_app_recording', title: '停止网页应用录制',
  description: '实验性功能。停止录制并等待应用交回前端资源，写成可离线重演的录制文件。返回状态与录制时发现的漏网调用提醒。',
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
  description: '分页读取网页录制的数据轨、行为轨、文字轨或界面元素位置轨，内容完整未脱敏。offset 从 0 开始，按 nextOffset 续读。boxes 每条是一个元素的变化点 {key, seconds, rect}，只返回位置变化、出现与消失（rect=null）；seconds 是录制时间秒数，rect 的 x/y/width/height 按视口宽高归一化，左上为原点，出视口部分裁切到 0–1。可按键、键前缀和时间范围过滤；补上范围起点已有的位置。按时间排序，同刻按采样元素顺序，每页最多 200 条，total 是过滤后变化点数。',
  aliases: ['读网页录制', '查看录制请求'], readOnly: true, risk: 'R0', permission: 'screen_recording:read', idempotent: true,
  inputSchema: z.object({ recordingRef: webRecordingRefSchema,
    track: z.enum(['data', 'behavior', 'text', 'boxes']).describe('data 网络请求与宿主调用；behavior 鼠标键盘与应用动作；text 画面文字轨；boxes 界面元素位置轨。没有 text 或 boxes 时先用 render_web_app_replay 重演一遍（可 textOnly=true）'),
    query: z.string().trim().min(1).max(200).optional().describe('只用于 text：按文字搜（不分大小写），返回每次出现的起止秒数与在画面里的位置（按画面宽高比例，左上为原点）；不给时按时间分页读整屏文字快照'),
    ...boxTrackQueryShape,
    offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(200).default(50) }).strict().refine(validBoxTimeRange, { path: ['toSeconds'], message: 'toSeconds 不得小于 fromSeconds' }),
  outputSchema: capabilityOutputSchema({ entries: z.array(z.unknown()), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() }),
  acceptsRefs: ['screen_recording.web_recording'], control: capabilityControl('observe', ['screen_recording.web_recording']),
  summarize: result => `已读取 ${result.entries.length} / ${result.total} 条。`,
})

export const renderWebAppReplayCapability = defineApplicationCapability({ ...common,
  id: 'render_web_app_replay', title: '重演网页录制并出视频',
  description: '实验性功能，需先开启设置属性 experimental.web_app_recording。不联网、不启动原应用，在痕迹内用录制的前端资源重新运行界面，按录制的操作和数据重演，逐帧编码成 MP4。默认出不画鼠标的干净画面，导入剪辑（import_web_recording）时会重画鼠标与点击；只想看重演效果时 pointer=true 把鼠标画进视频。要给成片用更清晰的画面时设 resolution（如 4k）。返回视频的本机路径与重演中发现的冲突（录制里没有的请求、缺失资源等）。',
  aliases: ['网页重演', '重演录制', 'replay web recording'], timeoutMs: 600000,
  inputSchema: z.object({ recordingRef: webRecordingRefSchema, fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
    pointer: z.boolean().default(false).describe('是否把鼠标画进视频：false（默认）干净画面，给剪辑用；true 画出鼠标与点击，只看重演效果时用'),
    textOnly: z.boolean().default(false).describe('true 只重演出画面文字轨和界面元素位置轨（不出视频），之后用 read_web_app_recording 的 text 或 boxes 查询；出视频时也会顺带写两条轨'),
    boxSelectors: boxSelectorsSchema.optional().describe('额外采样的 CSS 选择器，最多 32 个，如 [".ask", ".crumbs", ".settings-section"]。默认已采 [data-replay-id] 与 [data-act]；键优先 data-replay-id，否则 act:<值>#<同名序号>，其余用 <选择器>#<匹配序号>；序号从 0 开始且计入隐藏元素，重叠匹配取第一个选择器。重排或插入会改变序号，需跨结构变化稳定跟踪时请在被录应用标 data-replay-id。位置轨在 timeScale≥2 时每输出帧采样，其他档每两帧；复杂或大范围选择器会增加重演开销。'),
    resolution: z.enum(['recorded', '1080p', '1440p', '4k']).default('recorded').describe('清晰度：recorded（默认）按录制时的屏幕缩放；1080p / 1440p / 4k 把画面长边渲染到 1920 / 2560 / 3840 像素，保持原始比例，界面按矢量重新绘制而不是放大位图') }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, video: z.string(), pointer: z.boolean(), width: z.number().int(), height: z.number().int(), frames: z.number().int(), conflicts: z.array(z.string()), warnings: z.array(z.string()), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_recording'], producesRefs: ['screen_recording.web_recording'],
  resolveOperationTargets: input => [input.recordingRef],
  control: capabilityControl('execute', ['screen_recording.web_recording'], { cancelable: true }),
  summarize: result => `重演完成：${result.frames} 帧，${result.conflicts.length} 处冲突。`,
})

const destinationSchema = z.object({
  documentId: z.string().min(1).describe('目标剪辑文档 ID'),
  sequenceId: z.string().min(1).optional().describe('给出时把片段放进这个序列；不给时只进素材库'),
  frame: z.number().int().nonnegative().optional().describe('放到序列的第几帧，默认 0'),
}).strict()

export const importWebRecordingCapability = defineApplicationCapability({ ...common,
  id: 'import_web_recording', title: '将网页录制导入剪辑', permission: 'video_edit:write', supportsUndo: true, timeoutMs: 300000,
  description: '把网页录制作为一段普通视频导入剪辑：默认用最新的重演视频（干净、不带鼠标），没有时用备份录屏。录制里的鼠标与按键按视频时间换算成光标事件，片段自动带上鼠标效果（重新画鼠标与点击）和按点击建议的自动缩放，可在检查器里调整。给 sequenceId 时放到 frame 处的空视频轨，否则只进素材库。没有视频时先用 render_web_app_replay 重演出视频。需要网页录制读取与剪辑写入权限。',
  aliases: ['网页录制进剪辑', '网页录屏导入剪辑', 'web recording to edit'],
  inputSchema: z.object({
    recordingRef: webRecordingRefSchema, destination: destinationSchema,
    video: z.enum(['auto', 'replay', 'backup']).default('auto').describe('用哪段视频：auto 优先重演视频；replay 只用重演视频；backup 只用备份录屏（画面里已有鼠标，只画点击）'),
  }).strict(),
  outputSchema: capabilityOutputSchema({ resultRef: z.object({ kind: z.literal('video_edit.document'), id: z.string() }).strict(), itemIds: z.array(z.string()), clipIds: z.array(z.string()), video: z.enum(['replay', 'backup']), cursor: z.boolean(), warnings: z.array(z.string()), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_recording', 'video_edit.document'], producesRefs: ['video_edit.document'],
  resolveOperationTargets: input => [input.recordingRef, { kind: 'video_edit.document', id: input.destination.documentId }],
  resolveOperationWriteTargets: input => [{ kind: 'video_edit.document', id: input.destination.documentId }],
  resolveConcurrencyKey: input => `video_edit:${input.destination.documentId}`,
  control: capabilityControl('execute', ['video_edit.document'], { cancelable: true }),
  summarize: result => `已导入网页录制（${result.video === 'replay' ? '重演视频' : '备份录屏'}${result.cursor ? '，带鼠标效果与自动缩放' : ''}）。`,
})

export const importWebRecordingToProjectCapability = defineApplicationCapability({ ...common,
  id: 'import_web_recording_to_project', title: '把网页录制放进项目', permission: 'documents:write', timeoutMs: 600000,
  description: '把一段网页录制复制进项目，存成 素材/录屏/<名称>.hjweb 网页录制文档（不压缩的文件夹，项目文档列表里能看到）。来源二选一：recordingRef（应用数据里或别的项目里的录制），或 path（磁盘上任意一个网页录制文件夹，里面有 recording.json，例如从别处拷来的录制）。来源原样保留、不移动不修改；ID 已被占用时副本换新 ID。',
  aliases: ['网页录制存进项目', '导入网页录制文件夹', '录屏放进项目'],
  inputSchema: z.object({
    projectId: z.string().min(1).max(200).describe('目标项目（documents.project 的 ID）'),
    recordingRef: webRecordingRefSchema.optional(),
    path: z.string().min(1).max(32768).optional().describe('网页录制文件夹的本机绝对路径（与 recordingRef 二选一）'),
    name: z.string().trim().min(1).max(120).optional().describe('可选：项目里的名称；不给时沿用录制标题或文件夹名'),
  }).strict().refine(value => Boolean(value.recordingRef) !== Boolean(value.path), { message: 'recordingRef 与 path 二选一' }),
  outputSchema: capabilityOutputSchema({ resultRef: webRecordingRefSchema, documentRef: z.object({ kind: z.literal('documents.document'), id: z.string() }).strict(), directory: z.string(), verified: z.boolean() }),
  acceptsRefs: ['screen_recording.web_recording', 'documents.project'], producesRefs: ['screen_recording.web_recording', 'documents.document'],
  resolveOperationTargets: input => [{ kind: 'documents.project', id: input.projectId }, ...(input.recordingRef ? [input.recordingRef] : [])],
  resolveOperationWriteTargets: (_input, operationId) => [{ kind: 'screen_recording.web_recording', id: `pending:${operationId}` }],
  control: capabilityControl('create', ['screen_recording.web_recording', 'documents.document']),
  summarize: result => `网页录制已放进项目：${result.directory}`,
})

export const WEB_APP_RECORDING_CAPABILITIES = [startWebAppRecordingCapability, stopWebAppRecordingCapability, readWebAppRecordingCapability, renderWebAppReplayCapability, importWebRecordingCapability, importWebRecordingToProjectCapability]
