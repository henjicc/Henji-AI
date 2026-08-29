import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '../../src/core/assistant/hostContracts'
import type { AgentRunState } from '../../src/core/assistant/events'
import type {
  AgentApprovalResponse,
  AgentCancelRunRequest,
  AgentRunControlRequest,
  AgentRunEventsPage,
  AgentRunEventsRequest,
  AgentRuntimeEventPayload,
  AgentRunSnapshot,
  AgentStartRunRequest,
  AgentStartRunResult,
} from '../../src/core/assistant/runtimeContracts'
import type {
  AgentListRunsRequest,
  AgentRetryRunRequest,
  AgentRunSummary,
} from '../../src/core/assistant/persistence'
import type {
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  StructuredGenerationOutput,
} from '@henjicc/ai-sdk'
import type {
  AgentListThreadsRequest,
  AgentThreadSummary,
  AgentTranscriptPage,
  AgentTranscriptRequest,
  AgentEnqueueMessageRequest,
  AgentEnqueueMessageResult,
  AgentCancelQueuedMessageRequest,
  AgentSessionEntry,
  AgentDeleteThreadsRequest,
  AgentDeleteThreadsResult,
} from '../../src/core/assistant/session'
import type {
  AssistantUserInstructions,
  AssistantUserInstructionsUpdate,
} from '../../src/core/assistant/userInstructions'
import type {
  AssistantSkillDetail,
  AssistantSkillEnabledUpdate,
  AssistantSkillInstallRequest,
  AssistantSkillInstallResult,
  AssistantSkillManifest,
  AssistantSkillReadRequest,
} from '../../src/core/assistant/skills'
import type {
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySettings,
  AgentMemorySettingsUpdate,
  AgentMemoryState,
  AgentMemoryUpdate,
} from '../../src/core/assistant/memory'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '@henjicc/ai-sdk'
import type {
  AgentCancelExternalWaitRequest,
  GenerationStatusReportRequest,
} from '../../src/core/assistant/externalWait'
import type { ModelCapabilitySmokeRequest, ModelCapabilitySmokeResult } from '../../src/core/llm/capabilitySmoke'
import type {
  AgentTraceCaptureMode,
  AgentTraceDetailResult,
  AgentTraceQuery,
  AgentTraceQueryResult,
} from '../../src/core/assistant/trace'

export interface HenjiIpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
}

export interface HenjiAssistantApi {
  getUserInstructions(): Promise<AssistantUserInstructions>
  updateUserInstructions(update: AssistantUserInstructionsUpdate): Promise<AssistantUserInstructions>
  resetUserInstructions(): Promise<AssistantUserInstructions>
  openUserInstructionsFile(): Promise<string>
  listSkills(): Promise<AssistantSkillManifest>
  readSkill(request: AssistantSkillReadRequest): Promise<AssistantSkillDetail>
  installSkill(request: AssistantSkillInstallRequest): Promise<AssistantSkillInstallResult>
  uninstallSkill(name: string): Promise<void>
  setSkillEnabled(update: AssistantSkillEnabledUpdate): Promise<AssistantSkillManifest>
  openSkillsDirectory(): Promise<string>
  getMemoryState(): Promise<AgentMemoryState>
  updateMemorySettings(update: AgentMemorySettingsUpdate): Promise<AgentMemorySettings>
  updateMemory(update: AgentMemoryUpdate): Promise<AgentMemoryRecord>
  confirmMemoryCandidate(candidateId: string): Promise<AgentMemoryRecord>
  rejectMemoryCandidate(candidateId: string): Promise<void>
  deleteMemory(memoryId: string): Promise<void>
  clearMemories(scope?: AgentMemoryScope): Promise<number>
  publishHostContext(snapshot: HostContextSnapshot): Promise<void>
  acknowledgeFrontendTool(acknowledgement: FrontendToolAcknowledgement): Promise<void>
  completeFrontendTool(result: FrontendToolResult): Promise<void>
  onFrontendToolRequest(handler: (request: FrontendToolRequest) => void): () => void
  onFrontendToolCancel(handler: (cancel: FrontendToolCancel) => void): () => void
  startRun(request: AgentStartRunRequest): Promise<AgentStartRunResult>
  cancelRun(request: AgentCancelRunRequest): Promise<AgentRunState>
  pauseRun(request: AgentRunControlRequest): Promise<AgentRunState>
  resumeRun(request: AgentRunControlRequest): Promise<AgentRunState>
  respondApproval(request: AgentApprovalResponse): Promise<AgentRunState>
  getRunState(request: AgentRunControlRequest): Promise<AgentRunState>
  getRunSnapshot(request: AgentRunControlRequest): Promise<AgentRunSnapshot>
  getRunEvents(request: AgentRunEventsRequest): Promise<AgentRunEventsPage>
  listRuns(request: AgentListRunsRequest): Promise<AgentRunSummary[]>
  listThreads(request: AgentListThreadsRequest): Promise<AgentThreadSummary[]>
  deleteThreads(request: AgentDeleteThreadsRequest): Promise<AgentDeleteThreadsResult>
  getTranscript(request: AgentTranscriptRequest): Promise<AgentTranscriptPage>
  enqueueMessage(request: AgentEnqueueMessageRequest): Promise<AgentEnqueueMessageResult>
  cancelQueuedMessage(request: AgentCancelQueuedMessageRequest): Promise<AgentSessionEntry>
  reportGenerationStatus(request: GenerationStatusReportRequest): Promise<void>
  cancelExternalWait(request: AgentCancelExternalWaitRequest): Promise<AgentRunState>
  retryRun(request: AgentRetryRunRequest): Promise<AgentStartRunResult>
  subscribeEvents(handler: (payload: AgentRuntimeEventPayload) => void): () => void
}

export interface HenjiWindowStatePayload {
  isMaximized: boolean
}

export interface HenjiWindowContentSize {
  width: number
  height: number
}

export interface HenjiWindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getContentSize(): Promise<HenjiWindowContentSize>
  setZoomFactor(factor: 0.9 | 1 | 1.1): Promise<void>
  toggleDevTools(): Promise<void>
  onStateChanged(handler: (payload: HenjiWindowStatePayload) => void): () => void
  onCloseRequested(handler: () => void): () => void
  confirmClose(): Promise<void>
}

export interface HenjiDiagnosticsStreamEvent {
  streamId: string
  type: 'chunk' | 'done'
  data?: string
}

export interface HenjiDiagnosticsApi {
  ping(): Promise<{ pong: true; timestamp: number }>
  streamEcho(message: string, onEvent: (event: HenjiDiagnosticsStreamEvent) => void): Promise<() => Promise<void>>
}

export type HenjiSqlBindValue = string | number | boolean | null | Uint8Array

export interface HenjiSqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

export interface HenjiDbApi {
  execute(sql: string, params?: HenjiSqlBindValue[]): Promise<HenjiSqlExecuteResult>
  select<T = unknown>(sql: string, params?: HenjiSqlBindValue[]): Promise<T[]>
}

export interface HenjiCanvasProjectSummary {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface HenjiCanvasProjectSnapshot {
  nodes: unknown[]
  edges: unknown[]
  viewport: unknown
}

export interface HenjiCanvasProjectRecord extends HenjiCanvasProjectSummary, HenjiCanvasProjectSnapshot {}

export interface HenjiCanvasProjectsApi {
  listProjects(): Promise<HenjiCanvasProjectSummary[]>
  createProject(id: string, name: string, snapshot: HenjiCanvasProjectSnapshot): Promise<HenjiCanvasProjectRecord>
  getProject(projectId: string): Promise<HenjiCanvasProjectRecord | null>
  renameProject(projectId: string, name: string): Promise<void>
  saveProjectSnapshot(projectId: string, snapshot: HenjiCanvasProjectSnapshot): Promise<void>
  deleteProject(projectId: string): Promise<void>
}

export interface HenjiStoryboardProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  coverPath: string | null
}

export interface HenjiStoryboardProjectRecord extends HenjiStoryboardProjectSummary {
  nodesJson: string
  edgesJson: string
  viewportJson: string
  historyJson: string
}

export type HenjiStoryboardProjectWrite = Omit<HenjiStoryboardProjectRecord, 'coverPath'>

export interface HenjiStoryboardProjectsApi {
  listProjectSummaries(): Promise<HenjiStoryboardProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiStoryboardProjectRecord | null>
  upsertProjectRecord(record: HenjiStoryboardProjectWrite): Promise<void>
  updateProjectViewportRecord(projectId: string, viewportJson: string): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}

export interface HenjiCameraStageProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
  coverPath: string | null
}

export interface HenjiCameraStageProjectRecord extends HenjiCameraStageProjectSummary {
  sceneJson: string
}

export type HenjiCameraStageProjectWrite = Omit<HenjiCameraStageProjectRecord, 'coverPath'>

export type HenjiProjectCoverScope = 'canvas' | 'camera-stage'
export type HenjiProjectCoverSourceKind = 'image' | 'video'

export interface HenjiProjectCoverSource {
  source: string
  sourceKind: HenjiProjectCoverSourceKind
}

export interface HenjiProjectCoverRequest {
  scope: HenjiProjectCoverScope
  projectId: string
  sources: HenjiProjectCoverSource[]
}

export interface HenjiProjectCoverResult {
  projectId: string
  coverPath: string | null
}

export interface HenjiProjectCoversApi {
  saveCover(request: HenjiProjectCoverRequest): Promise<HenjiProjectCoverResult>
}

export interface HenjiCameraStageProjectsApi {
  listProjectSummaries(): Promise<HenjiCameraStageProjectSummary[]>
  getProjectRecord(projectId: string): Promise<HenjiCameraStageProjectRecord | null>
  upsertProjectRecord(record: HenjiCameraStageProjectWrite): Promise<void>
  renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void>
  deleteProjectRecord(projectId: string): Promise<void>
}

export type HenjiCameraStageRenderResolutionPreset = '720p' | '1080p'
export type HenjiCameraStageRenderOutputKind = 'image' | 'video'

export interface HenjiCameraStageRenderRequest {
  requestId: string
  nodeId: string
  projectId: string
  resolutionPreset: HenjiCameraStageRenderResolutionPreset
  outputKind: HenjiCameraStageRenderOutputKind
  selectedTimeSec?: number
}

export interface HenjiCameraStageImageRenderResult {
  kind: 'image'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  width: number
  height: number
  aspectRatio: string
  selectedTimeSec: number
}

export interface HenjiCameraStageVideoRenderResult {
  kind: 'video'
  mediaUrl: string
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export type HenjiCameraStageRenderResult = HenjiCameraStageImageRenderResult | HenjiCameraStageVideoRenderResult

export type HenjiCameraStageRenderEvent =
  | {
      type: 'progress'
      requestId: string
      nodeId: string
      phase: 'preparing' | 'rendering' | 'encoding'
      progress: number
    }
  | {
      type: 'completed'
      requestId: string
      nodeId: string
      result: HenjiCameraStageRenderResult
    }
  | {
      type: 'failed'
      requestId: string
      nodeId: string
      message: string
    }
  | {
      type: 'cancelled'
      requestId: string
      nodeId: string
    }

export interface HenjiCameraStageRenderApi {
  start(request: HenjiCameraStageRenderRequest): Promise<{ accepted: true }>
  cancel(requestId: string): Promise<void>
  onEvent(handler: (event: HenjiCameraStageRenderEvent) => void): () => void
  workerReady(): Promise<void>
  onWorkerJob(handler: (request: HenjiCameraStageRenderRequest) => void): () => void
  onWorkerCancel(handler: (requestId: string) => void): () => void
  reportWorkerEvent(event: HenjiCameraStageRenderEvent): Promise<void>
}

export interface HenjiCustomModelRecord {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: Record<string, unknown>
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface HenjiInsertCustomModelPayload {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: Record<string, unknown>
  isEnabled: boolean
}

export interface HenjiUpdateCustomModelPayload {
  name?: string
  config?: Record<string, unknown>
  isEnabled?: boolean
}

export interface HenjiCustomModelsApi {
  insertModel(model: HenjiInsertCustomModelPayload): Promise<void>
  listModels(providerId?: string): Promise<HenjiCustomModelRecord[]>
  getModel(modelId: string): Promise<HenjiCustomModelRecord | null>
  updateModel(modelId: string, updates: HenjiUpdateCustomModelPayload): Promise<void>
  deleteModel(modelId: string): Promise<void>
}

export interface HenjiProviderKeyStatus {
  providerId: string
  configured: boolean
}

export interface HenjiAiGenerateRequest {
  modelId: string
  params: Record<string, unknown>
  requestId?: string
}

export interface HenjiAiContinuePollingRequest {
  modelId: string
  taskId: string
  params?: Record<string, unknown>
}

export interface HenjiAiGetProgressEstimateRequest {
  modelId: string
  params?: Record<string, unknown>
}

export interface HenjiAiRecordProgressSampleRequest {
  modelId: string
  params?: Record<string, unknown>
  startedAtMs: number
  finishedAtMs: number
  source: 'generation' | 'canvas'
}

export interface HenjiAiGenerateResponse {
  status: 'completed' | 'pending' | 'failed'
  url: string
  filePath?: string
  taskId?: string
  metadata?: unknown
  structuredOutput?: StructuredGenerationOutput
  trace?: unknown
}

export interface HenjiAiProgressEstimate {
  durationMs: number
  source: 'time-bucket' | 'global' | 'seed' | 'meta' | 'default'
  profileKey: string
  timeBucket: 'night' | 'day' | 'evening'
  globalSampleCount: number
  bucketSampleCount: number
  defaultDurationMs: number
  globalEstimateMs: number
  bucketEstimateMs?: number
  recentGlobalDurationsMs: number[]
  recentBucketDurationsMs: number[]
}

export interface HenjiAiRecordProgressSampleResponse {
  actualDurationMs: number
  estimate: HenjiAiProgressEstimate
}

export interface HenjiProviderConnectionTestResult {
  providerId: string
  status:
    | 'connected'
    | 'saved_unverified'
    | 'not_configured'
    | 'invalid_key'
    | 'insufficient_balance'
    | 'rate_limited'
    | 'timeout'
    | 'network_error'
    | 'service_error'
  verified: boolean
  checkedAt: string
  durationMs: number
  httpStatus?: number
  remainingBalance?: number
  balanceUnit?: 'credits' | 'provider_units'
  unlimitedBalance?: boolean
}

export interface HenjiAiApi {
  setProviderApiKey(providerId: string, apiKey: string): Promise<void>
  removeProviderApiKey(providerId: string): Promise<void>
  getProviderApiKey(providerId: string): Promise<string | null>
  getProviderKeyStatus(): Promise<HenjiProviderKeyStatus[]>
  testProviderConnection(providerId: string): Promise<HenjiProviderConnectionTestResult>
  generate(request: HenjiAiGenerateRequest): Promise<HenjiAiGenerateResponse>
  continuePolling(request: HenjiAiContinuePollingRequest): Promise<HenjiAiGenerateResponse>
  cancelTask(taskId: string): Promise<void>
  getProgressEstimate(request: HenjiAiGetProgressEstimateRequest): Promise<HenjiAiProgressEstimate>
  recordProgressSample(request: HenjiAiRecordProgressSampleRequest): Promise<HenjiAiRecordProgressSampleResponse>
  consumePendingResult(serverTaskId: string): Promise<{
    url?: string
    filePath?: string
    metadata?: unknown
    structuredOutput?: StructuredGenerationOutput
  } | null>
}

export interface HenjiLlmApi {
  getProviderApiKey(credentialId: string): Promise<string | null>
  getProviderKeyStatus(credentialIds: string[]): Promise<Array<{ credentialId: string; configured: boolean }>>
  readConfig(): Promise<LlmConfigState | null>
  writeConfig(config: LlmConfigState): Promise<void>
  commitProviderSettings(request: {
    provider: LlmProviderConfig
    seedModels: LlmModelConfig[]
    baselineConfig: LlmConfigState
    credential: { kind: 'unchanged' } | { kind: 'set'; apiKey: string } | { kind: 'remove' }
  }): Promise<HenjiLlmProviderSettingsResult>
  deleteProviderSettings(request: {
    providerId: string
    baselineConfig: LlmConfigState
  }): Promise<HenjiLlmProviderSettingsResult>
  chatStream(request: HenjiLlmChatRequest, onEvent: (event: HenjiLlmStreamEvent) => void): Promise<void>
  modelStep(input: ModelStepInput, onEvent: (event: ModelStepEvent) => void): Promise<ModelStepResult>
  verifyModelCapabilities(request: ModelCapabilitySmokeRequest): Promise<ModelCapabilitySmokeResult>
  cancelTask(taskId: string): Promise<void>
  discoverModels(provider: Pick<
    LlmProviderConfig,
    'providerId' | 'providerFamilyId' | 'endpointProfile' | 'credentialId' | 'baseUrl'
  >): Promise<Array<{
    modelId: string
    displayName: string
    contextWindow: number | null
    maxOutputTokens: number | null
  }>>
}

export interface HenjiLlmProviderSettingsResult {
  config: LlmConfigState
  providerId: string
  credentialId: string
  configured: boolean
  apiKeyUrl: string | null
  credentialAction: 'unchanged' | 'set' | 'removed' | 'preserved_shared'
  rollbackStatus: 'not-needed' | 'completed'
}

export interface HenjiModelStepEventPayload {
  streamId: string
  event: ModelStepEvent
}

export type HenjiLlmRole = 'system' | 'user' | 'assistant'

export interface HenjiLlmContentPart {
  type: string
  text?: string
  imageUrl?: unknown
  videoUrl?: unknown
  inputAudio?: unknown
  [key: string]: unknown
}

export interface HenjiLlmChatMessage {
  role: HenjiLlmRole
  content?: string | HenjiLlmContentPart[] | null
  name?: string
  [key: string]: unknown
}

export interface HenjiLlmChatRequest {
  requestId?: string
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  modelId: string
  adapter?: string
  baseUrl?: string
  reasoning?: LlmReasoningConfig
  messages: HenjiLlmChatMessage[]
  capabilities?: Record<string, unknown>
  tools?: unknown
  policy?: Record<string, unknown>
  memory?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface HenjiLlmTrace {
  providerId: string
  modelId: string
  startedAtMs: number
  elapsedMs: number
  inputChars: number
  outputChars: number
}

export type HenjiLlmStreamEvent =
  | { type: 'Token'; data: string }
  | { type: 'ReasoningToken'; data: string }
  | { type: 'Done'; data: HenjiLlmTrace }
  | { type: 'Error'; data: string }

export interface HenjiLlmStreamEventPayload {
  streamId: string
  event: HenjiLlmStreamEvent
}

export interface HenjiImageMergeStoryboardImagesPayload {
  frameSources: string[]
  rows: number
  cols: number
  cellGap: number
  outerPadding: number
  noteHeight: number
  fontSize: number
  backgroundColor: string
  maxDimension: number
  showFrameIndex?: boolean
  showFrameNote?: boolean
  notePlacement?: 'overlay' | 'bottom'
  imageFit?: 'cover' | 'contain'
  frameIndexPrefix?: string
  textColor?: string
  frameNotes?: string[]
}

export interface HenjiImageMergeStoryboardImagesResult {
  imagePath: string
  canvasWidth: number
  canvasHeight: number
  cellWidth: number
  cellHeight: number
  gap: number
  padding: number
  noteHeight: number
  fontSize: number
  textOverlayApplied: boolean
  metadataEmbedded?: boolean
}

export interface HenjiImageStoryboardImageMetadata {
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export interface HenjiImagePanoramaMetadata {
  projectionType: 'equirectangular'
  usePanoramaViewer: true
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
}

export interface HenjiImagePanoramaMetadataReadResult {
  format: 'png' | 'jpeg' | 'webp' | 'unsupported'
  status: 'valid' | 'absent' | 'invalid' | 'unsupported'
  metadata: HenjiImagePanoramaMetadata | null
  reason?: string
}

export interface HenjiImagePanoramaMetadataEmbedResult {
  imagePath: string
  format: 'png' | 'jpeg' | 'webp'
  metadata: HenjiImagePanoramaMetadata
}

export interface HenjiImagePrepareNodeImageSourceResult {
  imagePath: string
  previewImagePath: string
  aspectRatio: string
}

export interface HenjiImageCropImageSourcePayload {
  source: string
  aspectRatio?: string
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
}

export interface HenjiImageInfoResult {
  source: string
  fileName: string | null
  extension: string
  width: number
  height: number
  orientation: number | null
  hasAlpha: boolean
  fileSizeBytes: number
  createdAt: number | null
  modifiedAt: number | null
}

export interface HenjiImageDiffusionFallbackRequest {
  requestId: string
  source: string
  purpose: 'preview' | 'export'
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  maxPreviewPixels?: number
  params: unknown
}

export interface HenjiImageDiffusionFallbackResult {
  bytes: Uint8Array
  width: number
  height: number
  format: 'png' | 'jpeg' | 'webp'
  durationMs: number
  hardCancellationSupported: false
  unsupportedParameters: readonly string[]
}

export interface HenjiImageDiffusionFallbackCapabilities {
  available: boolean
  supportedParameters: readonly string[]
  unsupportedParameters: readonly string[]
  maxPreviewPixels: number
  hardCancellationSupported: false
  supportedFormats: readonly ['png', 'jpeg', 'webp']
  reason?: string
}

export interface HenjiImageComposeLayerStackPayload {
  requestId: string
  stackId: string
  layers: Array<{
    sourceOutputIndex: number
    source: string
    zIndex: number
    role: 'base' | 'content'
    name?: string
    description?: string
    declaredWidth: number
    declaredHeight: number
    declaredFormat: 'png' | 'jpeg' | 'webp'
    boundingBox?: {
      absolute?: [number, number, number, number]
      normalized?: [number, number, number, number]
    }
    opacity?: number
    visible?: boolean
  }>
  thumbnailMaxSize?: number
  persistSourceLayers?: boolean
}

export interface HenjiImageComposeLayerStackResult {
  stackId: string
  canvasWidth: number
  canvasHeight: number
  resources: Array<{
    sourceOutputIndex: number
    filePath: string
    mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
    width: number
    height: number
    hasAlpha: boolean
    byteLength: number
    sha256: string
    placement: { x: number; y: number; width: number; height: number }
  }>
  compositePath: string
  compositeSha256: string
  thumbnailPath: string
  thumbnailSha256: string
  thumbnailWidth: number
  thumbnailHeight: number
  createdFilePaths: string[]
}

export interface HenjiImageApi {
  splitImage(imageBase64: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  splitImageSource(source: string, rows: number, cols: number, lineThickness: number): Promise<string[]>
  prepareNodeImageSource(source: string, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  prepareNodeImageBinary(bytes: Uint8Array, extension: string | undefined, maxPreviewDimension: number): Promise<HenjiImagePrepareNodeImageSourceResult>
  cropImageSource(payload: HenjiImageCropImageSourcePayload): Promise<string>
  mergeStoryboardImages(payload: HenjiImageMergeStoryboardImagesPayload): Promise<HenjiImageMergeStoryboardImagesResult>
  readStoryboardImageMetadata(source: string): Promise<HenjiImageStoryboardImageMetadata | null>
  embedStoryboardImageMetadata(source: string, metadata: HenjiImageStoryboardImageMetadata): Promise<string>
  readPanoramaImageMetadata(source: string): Promise<HenjiImagePanoramaMetadataReadResult>
  embedPanoramaImageMetadata(source: string): Promise<HenjiImagePanoramaMetadataEmbedResult>
  loadImage(filePath: string): Promise<string>
  persistImageSource(source: string): Promise<string>
  persistImageBinary(bytes: Uint8Array, extension: string): Promise<string>
  saveImageSourceToDownloads(source: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToPath(source: string, targetPath: string): Promise<string>
  saveImageSourceToDirectory(source: string, targetDir: string, suggestedFileName?: string): Promise<string>
  saveImageSourceToAppDebugDir(source: string, category: string, suggestedFileName?: string): Promise<string>
  readImageInfo(source: string): Promise<HenjiImageInfoResult>
  probeDiffusionFallback(): Promise<HenjiImageDiffusionFallbackCapabilities>
  renderDiffusionFallback(request: HenjiImageDiffusionFallbackRequest): Promise<HenjiImageDiffusionFallbackResult>
  compressImageSource(payload: {
    source: string
    maxPixels?: number
    quality?: number
    maxDimension?: number
  }): Promise<{ fullPath: string; dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
  composeLayerStack(payload: HenjiImageComposeLayerStackPayload): Promise<HenjiImageComposeLayerStackResult>
  cancelLayerStackComposition(requestId: string): Promise<void>
  releaseLayerStackResources(filePaths: string[]): Promise<void>
}

export interface HenjiVideoInfoResult {
  durationSeconds: number
  width: number
  height: number
  hasAudio: boolean
}

export interface HenjiVideoTrimVideoSourcePayload {
  source: string
  startSeconds: number
  endSeconds: number
}

export interface HenjiVideoTrimVideoSourceResult {
  path: string
  durationSeconds: number
}

export interface HenjiVideoCompressVideoToFitPayload {
  source: string
  maxSizeMB: number
}

export interface HenjiVideoCompressVideoToFitResult {
  path: string
  sizeBytes: number
}

export interface HenjiVideoStartFrameExportPayload {
  frameCount: number
  fps: number
  width: number
  height: number
  fileNameStem: string
}

export interface HenjiVideoAppendFrameExportPayload {
  sessionId: string
  frameIndex: number
  bytes: Uint8Array
}

export interface HenjiVideoFinishFrameExportPayload {
  sessionId: string
  targetPath?: string
}

export interface HenjiVideoFrameExportResult {
  mediaPath: string
  savedPath: string
  durationSeconds: number
  frameCount: number
  width: number
  height: number
}

export interface HenjiVideoFrameExportProgress {
  sessionId: string
  encodedFrames: number
}

export interface HenjiVideoApi {
  readVideoInfo(source: string): Promise<HenjiVideoInfoResult>
  trimVideoSource(payload: HenjiVideoTrimVideoSourcePayload): Promise<HenjiVideoTrimVideoSourceResult>
  compressVideoToFit(payload: HenjiVideoCompressVideoToFitPayload): Promise<HenjiVideoCompressVideoToFitResult>
  generateThumbnail(payload: { source: string; timeOffsetSeconds?: number; knownDurationSeconds?: number }): Promise<{ dataUrl: string }>
  generateThumbnailBytes(payload: { source: string; maxSize?: number }): Promise<{ bytes: Uint8Array }>
  startFrameExport(payload: HenjiVideoStartFrameExportPayload): Promise<{ sessionId: string }>
  appendFrameExport(payload: HenjiVideoAppendFrameExportPayload): Promise<{ frameIndex: number }>
  finishFrameExport(payload: HenjiVideoFinishFrameExportPayload): Promise<HenjiVideoFrameExportResult>
  cancelFrameExport(sessionId: string): Promise<void>
  onFrameExportProgress(listener: (progress: HenjiVideoFrameExportProgress) => void): () => void
}

export interface HenjiAudioExtractSamplesResult {
  rms: number[]
  peak: number[]
  durationSeconds: number
}

export interface HenjiAudioApi {
  extractSamples(payload: { source: string; bucketCount: number }): Promise<HenjiAudioExtractSamplesResult>
}

export interface HenjiFsDirEntry {
  name: string
  isDirectory: boolean
}

export interface HenjiDialogFilter {
  name: string
  extensions: string[]
}

export interface HenjiDialogSaveOptions {
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiDialogOpenOptions {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  filters?: HenjiDialogFilter[]
}

export interface HenjiFsApi {
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<HenjiFsDirEntry[]>
  copyFile(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
}

export interface HenjiDialogApi {
  save(options?: HenjiDialogSaveOptions): Promise<string | null>
  open(options?: HenjiDialogOpenOptions): Promise<string | string[] | null>
}

export interface HenjiShellApi {
  openExternal(url: string): Promise<void>
}

export interface HenjiPathsApi {
  appLocalDataDir(): Promise<string>
  downloadDir(): Promise<string>
  join(...parts: string[]): Promise<string>
  dirname(path: string): Promise<string>
  tempDir(): Promise<string>
}

export interface HenjiNativeFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface HenjiNativeFetchResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: Uint8Array
}

export interface HenjiHttpApi {
  fetch(request: HenjiNativeFetchRequest): Promise<HenjiNativeFetchResponse>
}

export interface HenjiMediaApi {
  allowRoot(rootPath: string): Promise<void>
  /** 判断某个绝对路径是否在 henji-media:// 协议允许读取的根目录范围内
   *  （应用本地数据目录/系统下载目录/系统临时目录/已动态注册的根目录）。
   *  用于在复用 getPathForFile 返回的原始路径前确认协议真的能读到它，
   *  避免出现"路径有效但协议 403 拒绝"的静默失败。 */
  isPathAllowed(targetPath: string): Promise<boolean>
  /** 直接拿渲染层 File 对象对应的本地文件系统路径（webUtils.getPathForFile），
   *  文件不是来自真实磁盘文件（如剪贴板生成的合成 Blob）时返回空字符串。 */
  getPathForFile(file: File): string
  /** 解析 resources/ 下随应用分发的内置只读资源（如3D 镜头参考角色 GLB）的绝对路径，
   *  并把所在根目录注册进 henji-media:// 白名单；文件不存在或越界时返回 null。 */
  getBundledResourcePath(relativePath: string): Promise<string | null>
  /** 受控渲染层媒体导入：路径只在主进程校验、复制和探测，不把文件内容送过 IPC。 */
  importFromPath(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromPathRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 仅供剪贴板或合成 Blob 等没有真实路径的媒体使用。 */
  importFromBytes(request: import('../../src/core/media/localMediaImportContracts').ImportMediaFromBytesRequest): Promise<import('../../src/core/media/localMediaImportContracts').LocalMediaImportResult>
  /** 只截取当前 Henji-AI 窗口内、由渲染层注册的应用表面区域，并在主进程覆盖敏感字段。 */
  captureApplicationSurface(request: import('../../src/core/assistant/surfaceObservation').SurfaceCaptureRequest): Promise<import('../../src/core/assistant/surfaceObservation').SurfaceCaptureResult>
}

export interface HenjiClipboardFileEntry {
  path: string
  data: string
  mimeType: string
}

export interface HenjiClipboardImage {
  dataUrl: string
  name: string
  origin: 'bitmap' | 'file'
}

export interface HenjiClipboardApi {
  readClipboardFiles(): Promise<HenjiClipboardFileEntry[]>
  readText(): Promise<string>
  readImage(): Promise<HenjiClipboardImage | null>
  writeImageFromPath(filePath: string): Promise<void>
  writeImageFromSource(source: string): Promise<void>
}

export interface HenjiDragApi {
  startNativeFileDrag(filePath: string, iconPath?: string): Promise<void>
  startNativeFileDragImmediate(filePath: string, iconPath?: string): void
}

export interface HenjiPackageMediaFile {
  srcPath: string
  packagePath: string
}

export interface HenjiImportedProjectPackage {
  manifestJson: string
  pathMap: Record<string, string>
}

export interface HenjiProjectPackageApi {
  exportProjectPackage(manifestJson: string, mediaFiles: HenjiPackageMediaFile[], targetPath: string): Promise<void>
  importProjectPackage(zipPath: string): Promise<HenjiImportedProjectPackage>
}

export interface HenjiLogEventBridgeDto {
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

export interface HenjiLogEvent {
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
  source: 'frontend' | 'backend'
  /** 单条事件体积保险丝命中时为 true，此时 context/error 已被主进程强制丢弃，见 `MainLogEvent`。 */
  truncatedByLimit?: boolean
}

/** 日志捕获模式：standard 沿用截断策略节省体积；full 长文本/图片 base64 不截断。 */
export type HenjiLogCaptureMode = 'standard' | 'full'

/** 历史日志查询参数（2.3 历史日志回读），语义见 `electron/main/services/logging/query.ts`。 */
export interface HenjiLogQueryParams {
  date: string
  level?: HenjiLogEvent['level']
  source?: HenjiLogEvent['source']
  domainPrefix?: string
  requestId?: string
  keyword?: string
  beforeTimestamp?: string
  afterTimestamp?: string
  beforeLine?: number
  limit?: number
}

export interface HenjiLogQueryResult {
  /** 命中事件，按时间戳降序排列（最新在前）。 */
  events: HenjiLogEvent[]
  hasMore: boolean
  corruptedLines: number
  nextBeforeLine?: number
}

export interface HenjiLoggingApi {
  logFrontendEvents(events: HenjiLogEventBridgeDto[]): Promise<void>
  onLogEvent(handler: (events: HenjiLogEvent[]) => void): () => void
  setCaptureConfig(mode: HenjiLogCaptureMode): Promise<void>
  getCaptureConfig(): Promise<HenjiLogCaptureMode>
  /** 打开（或聚焦已存在的）独立日志窗口（2.1 日志窗口骨架）。 */
  openLogWindow(): Promise<void>
  /** 列出当前存在的日志文件对应的日期（降序），供历史模式日期选择器使用。 */
  listLogDates(): Promise<string[]>
  /** 按日期流式查询历史日志事件，过滤/分页均在主进程完成。 */
  queryLogEvents(params: HenjiLogQueryParams): Promise<HenjiLogQueryResult>
  getAgentTraceCaptureMode(): Promise<AgentTraceCaptureMode>
  setAgentTraceCaptureMode(mode: AgentTraceCaptureMode): Promise<void>
  queryAgentTraces(params: AgentTraceQuery): Promise<AgentTraceQueryResult>
  getAgentTraceDetail(traceId: string): Promise<AgentTraceDetailResult | null>
  clearAgentTraces(date?: string): Promise<void>
}

export type HenjiUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface HenjiUpdaterReleaseInfo {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface HenjiUpdaterProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface HenjiUpdaterCheckResult {
  status: HenjiUpdaterStatus
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: HenjiUpdaterReleaseInfo
  progress?: HenjiUpdaterProgressInfo
  errorMessage?: string
}

export type HenjiUpdaterEvent =
  | { type: 'checking'; result: HenjiUpdaterCheckResult }
  | { type: 'available'; result: HenjiUpdaterCheckResult }
  | { type: 'not-available'; result: HenjiUpdaterCheckResult }
  | { type: 'download-progress'; result: HenjiUpdaterCheckResult }
  | { type: 'downloaded'; result: HenjiUpdaterCheckResult }
  | { type: 'error'; result: HenjiUpdaterCheckResult }

export interface HenjiUpdaterApi {
  getStatus(): Promise<HenjiUpdaterCheckResult>
  checkForUpdates(): Promise<HenjiUpdaterCheckResult>
  downloadUpdate(): Promise<HenjiUpdaterCheckResult>
  quitAndInstall(): Promise<void>
  onEvent(handler: (event: HenjiUpdaterEvent) => void): () => void
}

export interface HenjiNativeApi {
  runtimeInfo: {
    uiInspectionReadOnly: boolean
  }
  assistant: HenjiAssistantApi
  ai: HenjiAiApi
  llm: HenjiLlmApi
  db: HenjiDbApi
  canvasProjects: HenjiCanvasProjectsApi
  storyboardProjects: HenjiStoryboardProjectsApi
  cameraStageProjects: HenjiCameraStageProjectsApi
  projectCovers: HenjiProjectCoversApi
  cameraStageRender: HenjiCameraStageRenderApi
  customModels: HenjiCustomModelsApi
  fs: HenjiFsApi
  dialog: HenjiDialogApi
  shell: HenjiShellApi
  paths: HenjiPathsApi
  http: HenjiHttpApi
  media: HenjiMediaApi
  image: HenjiImageApi
  video: HenjiVideoApi
  audio: HenjiAudioApi
  clipboard: HenjiClipboardApi
  drag: HenjiDragApi
  projectPackage: HenjiProjectPackageApi
  logging: HenjiLoggingApi
  updater: HenjiUpdaterApi
  modelscope: Record<string, never>
  window: HenjiWindowApi
  diagnostics: HenjiDiagnosticsApi
  assetLibrary: HenjiAssetLibraryApi
}

export type HenjiAssetMediaType = 'image' | 'video' | 'audio'
export type HenjiAssetSource = 'generated' | 'canvas' | 'camera-stage' | 'imported' | 'external'
export interface HenjiAssetRecord { id: string; wasExisting?: boolean; mediaType: HenjiAssetMediaType; displayName: string; filePath: string; displayUrl: string; source: HenjiAssetSource; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; thumbnailPath: string | null; thumbnailUrl: string | null; inspectionStatus: 'pending' | 'ready' | 'missing' | 'failed'; inspectionError: string | null; fileModifiedAt: number | null; lastUsedAt: number | null; createdAt: number; updatedAt: number; tags: string[]; libraryIds: string[] }
export interface HenjiAssetLibraryRecord { id: string; name: string; createdAt: number; updatedAt: number }
export interface HenjiAssetLibrarySnapshot extends HenjiAssetLibraryRecord { assetIds: string[] }
export interface HenjiCreateAssetInput { filePath: string; mediaType: HenjiAssetMediaType; displayName?: string; source: HenjiAssetSource; libraryIds?: string[] }
export interface HenjiAssetQueryInput { mediaType?: HenjiAssetMediaType; libraryId?: string; tag?: string; keyword?: string; page?: number; pageSize?: number; sort?: 'created' | 'recent' }
export interface HenjiAssetPage { items: HenjiAssetRecord[]; total: number; page: number; pageSize: number }
export interface HenjiAssetLibraryApi {
  createAsset(input: HenjiCreateAssetInput): Promise<HenjiAssetRecord>
  updateAsset(id: string, name: string): Promise<HenjiAssetRecord>
  deleteAsset(id: string): Promise<void>
  queryAssets(input: HenjiAssetQueryInput): Promise<HenjiAssetPage>
  touchAsset(id: string): Promise<void>
  checkPaths(filePaths: string[]): Promise<boolean[]>
  inspectAsset(id: string): Promise<HenjiAssetRecord>
  inspectAssets(ids: string[]): Promise<HenjiAssetRecord[]>
  relocateAsset(id: string, filePath: string): Promise<HenjiAssetRecord>
  listLibraries(): Promise<HenjiAssetLibraryRecord[]>
  inspectLibrary(id: string): Promise<HenjiAssetLibrarySnapshot>
  createLibrary(name: string): Promise<HenjiAssetLibraryRecord>
  renameLibrary(id: string, name: string): Promise<HenjiAssetLibraryRecord>
  deleteLibrary(id: string): Promise<void>
  restoreLibrary(snapshot: HenjiAssetLibrarySnapshot): Promise<HenjiAssetLibraryRecord>
  addToLibrary(libraryId: string, assetId: string): Promise<void>
  removeFromLibrary(libraryId: string, assetId: string): Promise<void>
  listTags(): Promise<string[]>
  setAssetTags(assetId: string, tags: string[]): Promise<HenjiAssetRecord>
  rebaseDataRoot(oldRoot: string, newRoot: string): Promise<number>
}

declare global {
  interface Window {
    henjiNative?: HenjiNativeApi
  }
}

export {}
