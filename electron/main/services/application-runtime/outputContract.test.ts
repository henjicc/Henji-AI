// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { applicationOutputValidator, validateApplicationToolOutput } from './outputContract'
import { ApplicationHostBridge } from './applicationHostBridge'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { buildApplicationToolCatalog } from './toolCatalog'
import { projectApplicationToolResult } from './resultProjection'
import { toMcpResult } from '../mcp/resultProjection'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { capabilityVerificationEnvelope } from '../../../../src/core/application-control/capabilityVerification'
import { APPLICATION_WRITE_CAPABILITY_IDS, EXTERNAL_CONTRACT_VERSION } from '../../../../src/core/application-control/localHostContracts'
import { BLACK_HEX } from '../../../../src/core/theme/colorTokens'
const contractLog = vi.hoisted(() => vi.fn())
vi.mock('../logging', () => ({ createMainLogger: () => ({ error: contractLog, info: vi.fn(), warn: vi.fn() }) }))

const ref = (kind: string, id = 'document') => ({ kind, id })
const documentRef = ref('video_edit.document')
const sequenceRef = ref('video_edit.sequence', 'document:sequence')
const audioDocumentRef = ref('audio_edit.document', 'audio')
const clipRef = ref('video_edit.clip', 'document:clip')
const assetRef = ref('asset', 'asset')
const message = '已保存并回读核对'
const revisions = { revision: 29, scopeRevisions: { video_edit: 29, audio_edit: 1 } }
const verified = { verified: true, message }
const canvasRef = ref('canvas.document', 'canvas')
const nodeRef = ref('canvas.node', 'canvas:node')
const imageDocumentRef = ref('image_edit.document', 'v3:image')
const layerRef = ref('image_edit.layer', 'v3:image:layer')
const selectionRef = ref('image_edit.selection', 'v3:image:selection')
const input = { documentRef, sequenceRef, audioDocumentRef, clipRef, canvasRef, nodeRef, target: documentRef, ref: documentRef,
  documentId: 'document', nodeId: 'node', objectId: 'object', taskId: 'task', entityType: documentRef.kind }
const verification = (target = documentRef) => ({ verified: true, condition: message, target })

// 来自第四轮外部成功回执及现有领域测试的代表性回执，禁止从待测 outputSchema 反推样本。
const successData: Record<string, Record<string, unknown>> = {
  prepare_video_edit_subtitle_audio: { documentRef, audioDocumentRef, ...verified },
  generate_video_edit_subtitles: { documentRef, audioDocumentRef, captionRefs: [ref('video_edit.caption')], createdCaptionRefs: [ref('video_edit.caption')], ...verified },
  get_video_edit_clip_pauses: { clipRef, source: 'words_and_energy', pauses: [{ startFrame: 30, endFrame: 42, durationMs: 200, kind: 'silence', cutFrame: 36 }], words: [{ text: '你好', startFrame: 0, endFrame: 30 }], cutCandidates: [{ boundary: 'end', targetFrame: 30, cutFrame: 36, retainedFromFrame: 32, retainedToFrame: 40 }], message },
  query_video_edit_transcript: { documentRef, sequenceRef, total: 1, nextCursor: null, matches: [{ matchId: 'query:match', text: '你好', before: '', after: '欢迎', from: 0, to: 30, source: 'asr', precision: 'word', editable: true, clipRef, sourceRange: { startUs: 0, endUs: 1000000 }, selector: { kind: 'match', matchId: 'query:match' } }], message },
  query_video_edit_content: { documentRef, itemRef: ref('video_edit.item', 'document:item'), clock: 'source_microseconds', sourceVerified: true, discovery: { scope: 'project', complete: true, scannedDocuments: 1, matchedDocuments: 1 }, records: [{ id: 'source:word', kind: 'transcript', text: '你好', textTruncated: false, ranges: [{ fromUs: 0, toUs: 1000000 }], rangeCount: 1, basis: 'saved', precision: 'word', originRef: sequenceRef, recordId: 'word', sourceVerified: true }], total: 1, nextCursor: null, warnings: [], message },
  query_video_edit_source_map: { documentRef, sequenceRef, clock: 'sequence_frames', coverageBasis: 'timeline_structure', visibilityVerified: false, range: { fromFrame: 0, toFrame: 30 }, records: [{ id: 'audio:sequence/clip:0:30', medium: 'audio', kind: 'audio', timeline: { fromFrame: 0, toFrame: 30 }, path: [{ sequenceRef, clipRef, itemRef: ref('video_edit.item', 'document:item'), track: 0 }], sourceKind: 'media', mediaRef: ref('video_edit.media', 'document:media'), source: { fromUs: 1000000, toUs: 2000000, direction: 'forward', basis: 'continuous_audio' }, content: null }], total: 1, nextCursor: null, warnings: ['结构候选仍需观察复核。'], message },
  query_video_edit_review: { documentRef, sequenceRef, documentVersion: 'host:document:29:1', range: { fromFrame: 0, toFrame: 120 }, checkpoints: { frames: [8, 9, 14, 15], selection: 'prioritized_sample' }, records: [{ kind: 'tracking_lost', timeline: { fromFrame: 9, toFrame: 15 }, sequenceRef, subjectRef: ref('video_edit.tracker', 'document:tracker:4:clipfollow'), path: [{ sequenceRef, clipRef }], source: { fromUs: 300000, toUs: 500000 } }], total: 1, nextCursor: null, warnings: ['原始跟踪证据需要看图复核。'], message },
  query_video_edit_subtitle_correction: { documentRef, sequenceRef, planId: '8cf963c3-343c-4779-a417-f3d180e164cd', batchCount: 2, completed: 0, pending: 2, conflicts: 0, batch: { index: 0, state: 'pending', packet: { instructions: '按词范围校对，不提交时间。', rules: '保留口语', glossary: [], core: { startWord: 0, endWord: 1 }, words: [{ index: 0, text: '打开' }, { index: 1, text: '后台' }], baseline: [{ captionId: 'caption', startWord: 0, endWord: 1, text: '打开后台' }] }, estimatedInputTokens: 900, estimatedOutputTokens: 300, captionRefs: [ref('video_edit.caption', 'document:caption')], lastError: null }, protected: [], protectedCount: 0, protectedNextOffset: null, message },
  apply_video_edit_subtitle_correction: { documentRef, sequenceRef, batchIndex: 0, captionRefs: [ref('video_edit.caption', 'document:caption')], createdCaptionRefs: [], updatedCaptionRefs: [ref('video_edit.caption', 'document:caption')], changed: true, replayed: false, verified: true, message },
  translate_video_edit_subtitles: { documentRef, captionRefs: [ref('video_edit.caption')], ...verified },
  segment_video_edit_subtitles: { documentRef, captionRefs: [ref('video_edit.caption')], createdCaptionRefs: [ref('video_edit.caption')], updatedCaptionRefs: [ref('video_edit.caption')], removedCaptionRefs: [], ...verified },
  observe_video_edit_frame: { byteLength: 26670, resultRef: assetRef, documentRef, target: { kind: 'program', sequenceRef, frame: 60 }, width: 1280, height: 720, sourceWidth: 1920, sourceHeight: 1080, documentRevision: 29, documentVersion: 'host:document:29', message, verification: { verified: true, condition: '已保存合成帧', target: assetRef } },
  analyze_video_edit_color: { resultRef: clipRef, parameters: { exposure: 0 }, frame: 60, frames: [60], documentRevision: 29, documentVersion: 'host:document:29', message },
  observe_video_edit_color: { resultRef: sequenceRef, stage: 'after_grade', frame: 60, frames: [60], documentRevision: 29, documentVersion: 'host:document:29', message,
    readout: { exposure: { middleGrayOffsetEv: -.4, key: 'normal' }, clipping: { highlightsPercent: .2, shadowsPercent: 0 }, tone: { p2: 4, p50: 41, p98: 93 }, whiteBalance: { kelvin: 5400, tint: 2, confidence: .7, neutralPercent: 35 },
      color: { chromaMedian: .05, chromaP95: .14, oversaturatedPercent: 0, palette: [{ hex: BLACK_HEX, percent: 30 }] }, skin: { candidatePercent: 12, hueOffsetDegrees: 3 } } },
  analyze_image_edit_color: { resultRef: { kind: 'image_edit.layer', id: 'v3:doc:grade' }, parameters: { temperature_kelvin: 5200, tint: 3, exposure: .4 }, revision: 4, message },
  observe_image_edit_color: { resultRef: { kind: 'image_edit.document', id: 'v3:doc' }, stage: 'document', revision: 4, message,
    readout: { exposure: { middleGrayOffsetEv: -.4, key: 'normal' }, clipping: { highlightsPercent: .2, shadowsPercent: 0 }, tone: { p2: 4, p50: 41, p98: 93 }, whiteBalance: { kelvin: 5400, tint: 2, confidence: .7, neutralPercent: 35 },
      color: { chromaMedian: .05, chromaP95: .14, oversaturatedPercent: 0, palette: [{ hex: BLACK_HEX, percent: 30 }] }, skin: { candidatePercent: 12, hueOffsetDegrees: 3 } } },
  analyze_video_edit_beats: { resultRef: documentRef, markerRefs: [ref('video_edit.marker')], ...verified },
  render_video_edit_style: { resultRef: ref('video_edit.style', 'mine'), version: 2, changed: true, warnings: [], media: { preview: 'C:/styles/mine/preview.mp4', thumbnail: 'C:/styles/mine/thumbnail.jpg', anchors: ['C:/styles/mine/anchors/01.jpg'] }, message, verification: { verified: true, condition: '已回读预览' } },
  import_video_edit_style_package: { resultRef: ref('video_edit.style', 'mine'), templateRefs: [ref('video_edit.template', 'card')], replaced: false, message, verification: { verified: true, condition: '已回读' } },
  export_video_edit_style_package: { resultRef: ref('video_edit.style', 'mine'), path: 'C:/out/mine.hjsty', templateCount: 1, bytes: 1024, message, verification: { verified: true, condition: '已写出' } },
  bind_video_edit_style: { resultRef: ref('video_edit.project_style', 'document:mine'), sequenceRef, version: 2, upgraded: false, previous: null, message, verification: { verified: true, condition: '已保存' } },
  apply_video_edit_template: { resultRef: documentRef, templateRef: ref('video_edit.project_template', 'document:card'), clipRefs: [clipRef], copied: true, message, verification: { verified: true, condition: '已保存' } },
  create_video_edit_template: { resultRef: ref('video_edit.project_template', 'document:card'), libraryRef: null, kind: 'native', instanceCount: 1, message, verification: { verified: true, condition: '已保存' } },
  promote_video_edit_template: { resultRef: ref('video_edit.template', 'card'), templateRef: ref('video_edit.project_template', 'document:card'), version: 1, message, verification: { verified: true, condition: '已回读' } },
  update_video_edit_template: { resultRef: ref('video_edit.project_template', 'document:card'), version: 2, instanceCount: 3, message, verification: { verified: true, condition: '已保存' } },
  detach_video_edit_template_instance: { resultRef: documentRef, clipRefs: [clipRef], message, verification: { verified: true, condition: '已保存' } },
  get_current_application_context: { surface: { id: 'workspace.videoEdit', kind: 'workspace', focusedRef: null, selectedRefs: [] }, catalogRevision: 1, ready: true, externalContractVersion: EXTERNAL_CONTRACT_VERSION, ...revisions },
  read_application_entity: { ref: documentRef, entityType: documentRef.kind, properties: { name: '字幕项目', empty: '' }, revisions: { 'video_edit:document': 29 }, capturedAt: new Date(0).toISOString(), ...revisions },
  list_application_entities: { refs: [documentRef], items: [{ ref: documentRef, properties: { name: '字幕项目' } }], nextCursor: null, revisions: {}, ...revisions },
  search_models: { catalogVersion: '1', models: [{ id: 'fixture-model', label: '', available: true }], nextCursor: null, ...revisions },
  get_model_schema: { schemaVersion: '1', schemaRef: { id: 'fixture-model', version: 1, catalogVersion: 'application-capabilities/v1', kind: 'entity', digest: `sha256:${'a'.repeat(64)}` }, meta: { id: 'fixture-model' }, params: [{ id: 'prompt', default: '', min: null }], ...revisions },
  resolve_generation_model: { modelId: 'fixture-model', providerId: 'fixture', selection: 'requested', ...revisions },
  prepare_generation_task: { preparation: { prepared: true, providerConfigured: true, canSubmit: true, message: '可生成', modelId: 'fixture-model', providerId: 'fixture', mediaType: 'image', options: {} }, ...revisions },
  get_generation_task: { task: { taskId: 'task', status: 'success', resultAvailable: true, resultRef: ref('generation.result', 'task'), errorCode: null, recovery: null }, ...revisions },
  wait_generation_task: { task: { taskId: 'task', status: 'success', resultAvailable: true, resultRef: ref('generation.result', 'task'), recovery: null }, waitReason: 'terminal', ...revisions },
  create_visible_generation_task: { taskId: 'task', status: 'submitted', verification: verification(ref('generation.task', 'task')), ...revisions },
  load_assistant_skill: { name: 'video-edit-workbench', source: 'builtin', path: null, content: 'ASSISTANT_SKILL\n剪辑操作说明', bytes: 38, referencePaths: [] },
  describe_application_entities: { entities: [{ id: documentRef.kind, title: '剪辑文档' }], properties: [], nextCursor: null, propertyAvailability: [], collectionAvailability: [], ...revisions },
  list_documents: { documents: [{ ref: ref('documents.document'), name: '字幕项目', kind: 'video_edit', projectId: null, projectName: null, draft: false, missing: false, external: false, updatedAt: 1 }], total: 1, ...revisions },
  list_projects: { projects: [{ ref: ref('documents.project', 'project'), name: '创作项目', draft: false, external: false, missing: false, documentCount: 1 }], ...revisions },
  create_document: { resultRef: ref('documents.document'), name: '字幕项目', kind: 'video_edit', projectId: null, ...revisions },
  open_document: { resultRef: ref('documents.document'), name: '字幕项目', kind: 'video_edit', embedded: false, ...revisions },
  move_document: { resultRef: ref('documents.document'), name: '字幕项目', projectId: 'project', copiedFiles: 1, ...revisions },
  duplicate_document: { resultRef: ref('documents.document', 'copy'), sourceRef: ref('documents.document'), name: '副本', projectId: null, ...revisions },
  collect_document_media: { resultRef: ref('documents.document'), name: '字幕项目', copiedFiles: 1, copiedDocuments: 0, missingFiles: 0, message, ...revisions },
  create_project: { resultRef: ref('documents.project', 'project'), name: '创作项目', ...revisions },
  register_external_project: { resultRef: ref('documents.project', 'project'), name: '元宝搜索', external: true, documentCount: 0, ...revisions },
  trash_document: { resultRef: ref('documents.document'), name: '字幕项目', status: 'trashed', ...revisions },
  trash_project: { resultRef: ref('documents.project', 'project'), name: '创作项目', status: 'trashed', ...revisions },
  export_document_package: { fileName: '字幕项目.henji', files: 1, missingFiles: 0, ...revisions },
  list_toolbox_tools: { tools: [{ id: 'image_edit', title: '图片编辑' }], ...revisions },
  get_toolbox_state: { state: { currentToolId: 'image_edit' }, ...revisions },
  select_toolbox_tool: { toolId: 'audioEdit', surfaceId: 'tool.audio_edit', ...revisions },
  list_generation_history: { records: [{ id: 'task', mediaType: 'image', status: 'success' }] },
  cancel_generation_task: { taskId: 'task', status: 'cancelled', ...revisions },
  get_application_settings: { settings: [], revision: 29 },
  search_application_settings: { settings: [] },
  get_asset: { asset: { id: 'asset', name: '帧图片' }, ...revisions },
  query_assets: { page: 1, pageSize: 50, total: 1, items: [{ id: 'asset', name: '帧图片' }], ...revisions },
  list_asset_libraries: { libraries: [{ id: 'library', name: '素材' }], ...revisions },
  list_asset_tags: { tags: ['镜头'], ...revisions },
  select_asset: { assetId: 'asset', ...revisions },
  delete_asset: { assetId: 'asset', status: 'deleted', ...revisions },
  switch_workspace: { workspace: 'videoEdit', ...revisions },
  open_application_surface: { ...revisions },
  close_application_surface: { ...revisions },
  focus_application_entity: { ...revisions },
  search_canvas_node_types: { catalogVersion: '1', nodeTypes: [{ id: 'image' }], nextCursor: null, ...revisions },
  get_canvas_document: { document: { id: 'canvas', name: '画布' }, nodes: [{ id: 'node', type: 'image' }], edges: [], truncated: false, ...revisions },
  get_canvas_node: { node: { id: 'node', type: 'image' }, connectedEdges: [], ...revisions },
  get_canvas_node_schema: { schema: { id: 'image' }, ...revisions },
  focus_canvas_node: { documentId: 'canvas', nodeId: 'node', focused: true, surfaceId: 'workspace.canvas', ...revisions },
  select_canvas_node: { documentId: 'canvas', selectedNodeId: 'node', ...revisions },
  duplicate_canvas_node: { documentId: 'canvas', nodeId: 'copy', duplicatedFromNodeId: 'node', undoRef: 'undo', ...revisions },
  group_canvas_nodes: { documentId: 'canvas', groupNodeId: 'group', groupKind: 'spatial', accepted: 1, undoRef: 'undo', ...revisions },
  ungroup_canvas_node: { documentId: 'canvas', groupNodeId: 'group', undoRef: 'undo', ...revisions },
  clear_canvas: { documentId: 'canvas', clearedNodeCount: 1, clearedEdgeCount: 0, undoRef: 'undo', ...revisions },
  undo_canvas_change: { documentId: 'canvas', undoRef: 'undo', operation: 'group', status: 'undone', ...revisions },
  redo_canvas_change: { documentId: 'canvas', status: 'redone', ...revisions },
  connect_asset_group_to_target: { documentId: 'canvas', groupNodeId: 'group', targetNodeId: 'node', connected: 1, pending: 0, unsupported: 0, excluded: 0, undoRef: 'undo', ...revisions },
  disconnect_asset_group_from_target: { documentId: 'canvas', groupNodeId: 'group', targetNodeId: 'node', undoRef: 'undo', ...revisions },
  apply_canvas_image_capability: { documentId: 'canvas', kind: 'canvas-node', capabilityId: 'image.relight', sourceNodeId: 'node', nodeId: 'new', edgeId: 'edge', undoRef: 'undo', ...revisions },
  add_asset_to_canvas: { documentId: 'canvas', assetId: 'asset', mediaType: 'image', nodeId: 'node', nodeType: 'image', nodeRef, undoRef: 'undo', verification: { verified: true, condition: message }, ...revisions },
  add_generation_result_to_canvas: { documentId: 'canvas', resultRef: ref('generation.result', 'task'), mediaType: 'image', nodeId: 'node', nodeType: 'image', nodeRef, undoRef: 'undo', verification: { verified: true, condition: message }, ...revisions },
  download_canvas_media: { documentId: 'canvas', savedNodeIds: ['node'], failedNodeIds: [], requestedCount: 1, destinationMode: 'quick', directory: 'E:/下载', ...revisions },
  submit_canvas_node_generation: { taskId: 'task', status: 'submitted', ...revisions },
  resume_canvas_generation_task: { taskId: 'task', status: 'success', task: { status: 'success' }, ...revisions },
  retry_layer_stack_result: { nodeRef: ref('canvas.node', 'canvas:layers'), status: 'retrieving', resultRefs: [nodeRef], ...revisions },
  retry_audio_edit_save: { resultRef: audioDocumentRef, ...verified },
  send_video_edit_clip_to_audio_edit: { resultRef: documentRef, audioDocumentRef, clipRef, created: true, message, verified: true },
  create_image_edit_preview: { previewRef: 'preview', sourceRef: assetRef, resultRefs: [ref('image_edit.preview', 'preview')], operationCount: 1, hasEffect: true, width: 1280, height: 720, ...revisions },
  commit_image_edit: { previewRef: 'preview', assetId: 'asset', status: 'committed', resultRefs: [assetRef], verification: verification(assetRef), ...revisions },
  open_image_editor_with_source: { sourceRef: assetRef, resultRefs: [ref('application.surface', 'tool.image_edit')], surfaceId: 'tool.image_edit', ...revisions },
  open_multi_layer_document_node_editor: { canvasRef, nodeRef, surfaceId: 'workspace.canvas', editorKind: 'multi_layer_document', status: 'opened', resultRefs: [canvasRef, nodeRef, ref('application.surface', 'workspace.canvas')], ...revisions },
  compute_image_edit_selection: { ref: selectionRef, verification: { verified: true }, ...revisions },
  apply_image_edit_selection: { ref: layerRef, commandId: 'command', verification: { verified: true }, ...revisions },
  convert_image_edit_filter_scope: { ref: ref('image_edit.layer_filter', 'v3:image:layer:filter'), ownerRef: layerRef, commandId: 'command', beforeTargets: ['layer'], afterTargets: ['layer'], verification: { verified: true }, ...revisions },
  select_image_edit_region: { ref: selectionRef, status: 'selected', candidates: [], verification: { verified: true }, ...revisions },
  paint_image_edit_target: { ref: layerRef, changed: true, commandId: 'command', verification: { verified: true }, ...revisions },
  remove_image_edit_region: { ref: layerRef, documentRef: imageDocumentRef, commandId: 'command', verification: { verified: true }, ...revisions },
  repair_image_edit_region: { ref: layerRef, documentRef: imageDocumentRef, commandId: 'command', verification: { verified: true }, ...revisions },
  resample_image_edit_image: { ref: imageDocumentRef, width: 1280, height: 720, commandId: 'command', createdLayers: [], removedLayers: [], verification: { verified: true }, ...revisions },
  use_image_edit_clipboard: { ref: layerRef, verified: true, ...revisions },
  generate_image_edit_outpaint: { documentRef: imageDocumentRef, taskRef: ref('generation.task', 'task'), status: 'submitted', verified: true, message },
  get_image_edit_outpaint: { documentRef: imageDocumentRef, taskRef: ref('generation.task', 'task'), status: 'placed', progress: 100, layerRef, message },
  recover_image_edit_outpaint: { documentRef: imageDocumentRef, taskRef: ref('generation.task', 'task'), status: 'placed', progress: 100, layerRef, message, verification: { verified: true, condition: message } },
  apply_video_edit_scenes: { resultRef: documentRef, changedRefs: [clipRef], cutFrames: [60], ...verified },
  detect_video_edit_scenes: { resultRef: documentRef, analysisId: 'analysis', cutsSeconds: [1], cutFrames: [60], message },
  auto_reframe_video_edit: { resultRef: sequenceRef, documentRef, clipRefs: [clipRef], created: true, faceFrames: 5, missingFrames: 0, exportJobIds: [], ...verified },
  generate_video_edit_audio_ducking: { resultRef: documentRef, clipRefs: [clipRef], ...verified },
  generate_video_edit_proxy: { resultRef: ref('video_edit.media'), preset: '720p', ...verified },
  stagger_video_edit_motion: { resultRefs: [clipRef], message, verification: { verified: true, condition: message } },
  send_video_edit_to_canvas: { nodeRef, assetRef, undoRef: 'undo', message, verification: verification(nodeRef) },
  edit_video_edit_program_frame: { surfaceRef: ref('application.surface', 'tool.image_edit'), assetRef, documentRef, sequenceRef, frameEditSessionRef: 'session', returnPlacement: { mode: 'add', frame: 60, durationFrames: 1 }, message, verification: { verified: true, condition: message } },
  place_video_edit_creative_result: { resultRef: clipRef, documentRef, assetRef, message, verification: verification(clipRef) },
  restore_video_edit_clip_take: { resultRef: clipRef, documentRef, message, verification: verification(clipRef) },
  open_video_edit_clip_source: { resultRef: clipRef, documentRef, status: 'opened', sourceType: 'document', message, verification: verification(clipRef) },
  nest_video_edit_clips: { resultRef: documentRef, sequenceRef, parentSequenceRef: sequenceRef, itemRef: ref('video_edit.item'), clipRef, movedClipRefs: [clipRef], message, verification: verification() },
  ripple_video_edit_clip_speed: { resultRef: documentRef, changedClipRefs: [clipRef], message, verification: verification() },
  follow_video_edit_tracker: { resultRef: clipRef, follow: { trackerId: 'tracker', mode: 'transform' }, keyframes: { x: 4, y: 4, scale: 0, rotation: 4 }, message, verification: verification(clipRef) },
  stabilize_video_edit_clip: { resultRef: clipRef, stabilization: { smoothness: 'natural', maxCrop: 0.15, rotation: true, scale: false }, crop: 0.07, analyzedFrames: 300, message, verification: verification(clipRef) },
  track_video_edit_recording: { resultRef: ref('video_edit.tracker', 'document:tracker'), clipRef, message, verification: verification(clipRef) },
  ramp_video_edit_clip_speed: { resultRef: documentRef, changedClipRefs: [clipRef], durationFrames: 120, curve: [{ sourceSeconds: 0, speedPercent: 100 }, { sourceSeconds: 2, speedPercent: 30 }], snappedSeconds: [3], message, verification: verification() },
  get_video_edit_in_place_generation: { documentRef, taskRef: ref('generation.task', 'task'), status: 'placed', progress: 100, clipRef, takeIndex: 0, message },
  discard_video_edit_in_place_generation: { documentRef, taskRef: ref('generation.task', 'task'), status: 'removed', ...verified },
  recover_video_edit_in_place_generation: { documentRef, taskRef: ref('generation.task', 'task'), status: 'placed', ...verified },
  retry_video_edit_smart_region: { resultRef: ref('video_edit.effect'), status: 'analyzing', message, verified: true },
  export_image_edit_target_to_canvas: { canvasRef, sourceNodeRef: nodeRef, targetRef: layerRef, nodeRef, edgeRef: ref('canvas.edge', 'canvas:edge'), undoRef: 'undo', width: 1280, height: 720, mediaType: 'image/png', verification: verification(canvasRef), ...revisions },
  cancel_local_model_download: { resultRef: ref('local_model.item', 'model'), cancelled: true, status: 'not_downloaded', message, verification: verification(ref('local_model.item', 'model')) },
  delete_camera_stage_object: { documentId: 'camera', objectId: 'object', status: 'deleted', ...revisions },
  duplicate_camera_stage_object: { documentId: 'camera', objectId: 'copy', duplicatedFromObjectId: 'object', undoRef: 'undo', ...revisions },
  observe_camera_stage_scene: { scene: { objects: [{ id: 'object' }] }, ...revisions },
  verify_camera_stage_scene: { verified: true, checkedAt: new Date(0).toISOString(), evidence: [], unmetConditions: [], ...revisions },
  organize_camera_stage_motion: { resultRef: ref('camera_stage.document', 'camera'), reviewId: 'review', candidates: [{ id: 'candidate', label: '移动' }], unavailable: [], ...revisions },
  apply_camera_stage_motion_candidate: { resultRef: ref('camera_stage.document', 'camera'), saved: true, undoToken: 'undo', stateKeyframeRefs: [ref('camera_stage.state_keyframe', 'camera:key')], verification: { verified: true, condition: message }, ...revisions },
  render_camera_stage_output: { taskRef: ref('camera_stage.render_task', 'task'), status: 'submitted', resultRefs: [ref('camera_stage.render_task', 'task')], ...revisions },
  cancel_camera_stage_render_task: { taskRef: ref('camera_stage.render_task', 'task'), status: 'cancelled', resultRefs: [nodeRef], ...revisions },
  prepare_canvas_node_generation: { preparation: { prepared: true, modelId: 'fixture-model', providerId: 'fixture', mediaType: 'image', options: {} }, submitInput: { documentId: 'canvas', nodeId: 'node' }, ...revisions },
  prepare_image_edit_outpaint: { documentRef: imageDocumentRef, preparation: { prepared: true, modelId: 'fixture-model', providerId: 'fixture', mediaType: 'image', options: {} }, message },
}

// 录制服务的会话控制、事件分页、理解/隐私、导入与成片回执；与各领域结果测试保持同形。
const recordingRef = ref('screen_recording.session', '3e8b1d7c-6a2f-4c95-9d40-7f1e5a3c8b26')
const understandingRef = ref('screen_recording.understanding', recordingRef.id)
successData.plan_screen_recording_director = { resultRef: recordingRef, verified: true }
successData.start_screen_recording_director = { resultRef: documentRef, sessionRef: recordingRef, sequenceRefs: [sequenceRef], verified: true }
successData.cancel_screen_recording_director = { resultRef: recordingRef, verified: true }
successData.redub_screen_recording_sentence = { resultRef: clipRef, verified: true, undoSteps: 1 }
for (const action of ['start', 'pause', 'resume', 'mark', 'stop', 'cancel', 'recover']) {
  successData[`${action}_screen_recording`] = { resultRef: recordingRef, ...verified, ...revisions }
}
successData.read_screen_recording_events = { events: [{ kind: 'control', action: 'stop', eventId: 'stop', monoUs: 13000000, recordingUs: 10000000, seq: 1, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static' }], nextOffset: null, message, ...revisions }
successData.import_screen_recording = { resultRef: documentRef, itemIds: ['screen', 'mic'], ...verified, ...revisions }
successData.understand_screen_recording = { resultRef: understandingRef, steps: 1, candidates: 2, audioUpdates: [{ ref: audioDocumentRef, created: true, transcribed: true }], undoRef: 'understanding-undo', ...verified, ...revisions }
successData.detect_screen_recording_sensitive_text = { resultRef: understandingRef, candidates: 1, undoRef: 'privacy-undo', ...verified, ...revisions }
successData.generate_screen_recording_script = { resultRef: understandingRef, steps: 3, blocked: 0, undoRef: 'script-undo', verified: true }
successData.replay_screen_recording_script = { resultRef: understandingRef, completedSteps: ['step0', 'step1'], replaced: 0, verified: true }
successData.rerecord_screen_recording_steps = { resultRef: documentRef, completedSteps: ['step0', 'step1'], replaced: 1, verified: true }
successData.generate_screen_recording_movie = { documentRef, resultRef: sequenceRef, sequenceRefs: [sequenceRef], warnings: [], verified: true }
successData.generate_video_edit_screen_attention = { documentRef, resultRef: sequenceRef, clipRefs: [clipRef], created: false, quietFrames: 30, impreciseCapabilities: 1, ...verified }
successData.detect_video_edit_sensitive_text = { resultRef: clipRef, effectRefs: [ref('video_edit.effect', 'document:clip:privacy')], ...verified }
const recordingExportRef = ref('screen_recording.export', 'd8074d10-8d5e-45db-a99a-c1e5d91ff854')
successData.export_screen_recording_product = { resultRef: recordingExportRef, state: 'completed', files: ['step-001.png', 'steps.md', 'steps.html'], documentRefs: [], warnings: [], verified: true }
successData.cancel_screen_recording_export = { resultRef: recordingExportRef, verified: true }
// 对照 assistant/application/applicationDomain.ts 的 receipt 与
// screenRecording/application/webAppRecording.ts 的正式处理器返回值。
for (const name of ['organize_assistant_memory', 'revert_assistant_memory']) {
  successData[name] = { resultRef: ref('assistant.memory_settings', 'singleton'), changed: 1,
    message: '记忆已更新，可在修改历史中查看并撤回。', verification: { verified: true, condition: '已回读记忆状态，修改写入历史。' } }
}
const webRecordingRef = ref('screen_recording.web_recording', '2e811354-8fe6-4fd8-a174-8e0657f5cde8')
successData.start_web_app_recording = { resultRef: webRecordingRef, directory: 'D:/项目/素材/录屏/网页录制.hjweb', verified: true, ...revisions }
successData.import_web_recording = { resultRef: ref('video_edit.document'), itemIds: ['item'], clipIds: ['clip'], video: 'replay', cursor: true, warnings: [], verified: true, ...revisions }
successData.import_web_recording_to_project = { resultRef: webRecordingRef, documentRef: ref('documents.document', webRecordingRef.id), directory: 'D:/项目/素材/录屏/网页录制.hjweb', verified: true, ...revisions }
successData.stop_web_app_recording = { resultRef: webRecordingRef, status: 'complete', durationMs: 1000, warnings: [], verified: true, ...revisions }
// 数据轨沿 webReplay/matcher.test.ts 的 HTTP 录制条目结构，保留分页续读。
successData.read_web_app_recording = { entries: [{ kind: 'http', id: 1, t: 10, via: 'seam', method: 'GET', url: 'https://example.test/data', headers: [], chunks: [] }], total: 2, nextOffset: 1, ...revisions }
successData.render_web_app_replay = { resultRef: webRecordingRef, video: 'replay.clean.mp4', pointer: false, width: 1280, height: 720, frames: 30, conflicts: [], warnings: [], verified: true, ...revisions }
const taskObservation = { taskRef: ref('camera_stage.render_task', 'task'), status: 'completed', revisions: { camera_stage: 1 }, phase: null, progress: 1, outputKind: 'image', message, resultRefs: [nodeRef], recovery: null, ...revisions }
successData.get_camera_stage_render_task = taskObservation
successData.wait_camera_stage_render_task = { ...taskObservation, waitReason: 'terminal' }
successData.recover_camera_stage_render_task = { ...taskObservation, recoveryAttempted: true }
const transaction = { status: 'completed', transactionRef: 'transaction', undoRef: 'undo', verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: new Date(0).toISOString() }, resultingRevisions: { 'video_edit:document': 29 }, resultRefs: [documentRef], effects: [], evidence: [], ...revisions }
for (const name of ['change_application_entities', 'undo_application_changes']) successData[name] = transaction
for (const name of ['apply_camera_stage_camera_move', 'place_camera_stage_object']) successData[name] = { ...transaction }
const generationPlan = { action: 'generate_shot', sequenceRef, startSeconds: 1, durationSeconds: 5, trackRef: null, placement: 'add', references: [] }
successData.generate_video_edit_in_place = { documentRef, taskRef: ref('generation.task', 'task'), plan: generationPlan, status: 'submitted', verified: true, message }
successData.prepare_video_edit_in_place_generation = { documentRef, plan: generationPlan, preparation: { prepared: true, modelId: 'fixture-model', providerId: 'fixture', mediaType: 'video', options: {} }, stylePrompt: '', message }
for (const name of ['export_video_edit', 'query_video_edit_export', 'cancel_video_edit_export']) {
  successData[name] = { resultRef: documentRef, message, verification: verification(), queue: [], task: { id: 'export', state: 'completed', progress: 1, revision: 29, startFrame: 0, endFrame: 60 } }
}
successData.query_video_edit_export = { resultRef: documentRef, message, verification: verification(), queue: [], total: 0, nextCursor: null }

for (const name of ['measure_video_edit_loudness', 'normalize_video_edit_loudness']) {
  successData[name] = { resultRef: documentRef, results: [{ clipRef, volume: 1, gainDb: 6, measurement: { integratedLufs: -16, shortTermLufs: -15, truePeakDbtp: -1, samplePeakDbfs: -2, durationSeconds: 5 } }], ...verified }
}
for (const domain of ['image_edit', 'video_edit']) {
  for (const action of ['organize', 'interpret']) successData[`${action}_${domain}_intent`] = { resultRef: ref(`${domain}.intent_draft`), candidateRefs: [ref(`${domain}.intent_candidate`)], status: 'candidate', questions: [], ...revisions }
  successData[`read_${domain}_intent_recording`] = { resultRef: domain === 'video_edit' ? documentRef : imageDocumentRef, lines: ['{"text":"请缩短片头"}'], nextOffset: null, nextImageOffset: null, semanticImages: [], inputReceipt: 'receipt', ...revisions }
}
successData.read_video_edit_super_keyframes = { resultRef: ref('video_edit.intent_draft'), lines: ['{"take":1,"target":"clip"}'], nextOffset: null, ...revisions }
for (const name of ['import_video_edit_asset', 'import_video_edit_folder', 'save_video_edit', 'split_video_edit', 'add_video_edit_frame_hold', 'trim_video_edit_clip', 'undo_video_edit', 'redo_video_edit']) {
  successData[name] = { resultRef: documentRef, message, verification: verification() }
}
successData.add_sound_library_folder = { status: 'added', resultRef: ref('sound_library.folder'), folderStatus: 'indexing', message, verification: { verified: true, condition: '已回读登记表。' } }
successData.search_sound_effects = { matches: [{ soundRef: ref('sound_library.sound'), folderRef: ref('sound_library.folder'), name: '嗖02-短', englishName: null, chineseName: '嗖02-短', relativePath: '转场/嗖02-短.mp3', durationSeconds: 0.9, attackSeconds: 0.2, hitSeconds: 0.36, peakDbfs: -1, loudnessLufs: -12, brightness: 'bright', score: 0.9, matchedBy: ['name'] }], noGoodMatch: false, listening: 'model_not_downloaded', considered: 2, indexedSounds: 2, skippedFiles: 0, message }
successData.place_video_edit_sound_effects = { resultRefs: [clipRef], documentRef, placements: [{ clipRef, soundRef: ref('sound_library.sound'), startFrame: 10, targetSeconds: 0.5, anchorSeconds: 0.36, alignedSeconds: 0.5, trimmedHeadSeconds: 0.026, trackRef: ref('video_edit.track') }], message, verification: { verified: true, condition: '已回读。' } }
successData.remix_video_edit_music = { documentRef, resultRefs: [clipRef], remixId: 'remix', startFrame: 30, targetFrames: 2700, seams: [{ frame: 1290, confidence: 0.82, kind: 'repeat', fromSeconds: 61.5, toSeconds: 18.4 }], trimmedSeconds: 0.4, analysis: { tempo: 128, beatsPerBar: 4, beatSource: 'beat_this', cached: false, model: 'used' }, message, verification: { verified: true, condition: '已回读。' } }
successData.render_video_edit_preview = { documentRef, pendingWindows: 2, readyFrames: 1800, requestedFrames: 3600, verified: true, message }
for (const name of ['collect_video_edit_code_asset', 'collect_video_edit_output']) {
  successData[name] = { resultRef: assetRef, documentRef, message, verification: verification(assetRef) }
}
for (const name of ['create_video_edit_multicam', 'auto_switch_video_edit_multicam']) {
  successData[name] = { resultRef: documentRef, sequenceRef, itemRef: ref('video_edit.item'), clipRefs: [clipRef], message, verification: verification() }
}
// 正式文档处理器的 verifyDocument/项目回执及生成取消回执已自行核实，并带 target。
// 它们属于 passthrough 领域输出，公共桥接须保留，公共 schema 也必须明确声明。
for (const name of ['create_document', 'open_document', 'move_document', 'duplicate_document', 'collect_document_media', 'trash_document', 'create_project', 'register_external_project', 'trash_project', 'export_document_package', 'cancel_generation_task']) {
  const data = successData[name]
  const target = name === 'cancel_generation_task' ? ref('generation.task', 'task')
    : name === 'export_document_package' ? ref('documents.document') : data.resultRef as { kind: string; id: string }
  successData[name] = { ...data, verification: verification(target) }
}
for (const name of ['ripple_delete_video_edit_text', 'extract_video_edit_text', 'insert_video_edit_text', 'detect_video_edit_text_silence']) {
  successData[name] = { documentRef, resultRef: sequenceRef, ranges: [{ from: 0, to: 60 }], changed: true, ...verified }
}
for (const name of ['reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'transcribe_audio_edit', 'process_audio_edit_sound', 'export_audio_edit', 'query_audio_edit_tasks', 'cancel_audio_edit_task', 'repair_audio_edit_region', 'insert_audio_edit_file']) {
  successData[name] = { resultRef: audioDocumentRef, ...verified, count: 1, shortenedMs: 100, durationFrames: 2400, tasks: [{ requestId: 'task', documentId: 'audio', kind: 'processing', state: 'completed', progress: 100 }] }
}

const host = new ApplicationHostBridge(() => {})
const tools = buildApplicationToolCatalog({ tools: host.tools(), access: { allowWrites: true, allowPaid: true, allowDestructive: true }, operationsEnabled: true, includeSkillTool: true }).tools
const validator = applicationOutputValidator
// 本轮有 outputSchema 的工具均有回执；未来不可构造的工具必须逐个登记具体原因，不能按域豁免。
const uncoveredTools: Record<string, string> = {}

describe('外部客户端成功输出 JSON Schema 契约', () => {
  it('定向连续帧与参考比较的公共输出保留实际帧列表、参考时间和固定作品版本', () => {
    const name = 'observe_video_edit_frame'; const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)!
    const comparison = { referenceItemRef: ref('video_edit.item', 'document:reference'), referenceTimesUs: [0, 0, 0] }
    for (const target of [{ kind: 'frames', sequenceRef, frames: [29, 30, 31] }, { kind: 'near_cut', sequenceRef, cutFrame: 30, before: 1, after: 1 }]) {
      const data = definition.outputSchema.parse({ ...successData[name], target, comparison, contactSheet: { frames: [29, 30, 31], columns: 4, rows: 2 } }) as Record<string, unknown>
      const raw = { ok: true, data: capabilityVerificationEnvelope(definition, input, data) }
      const result = toMcpResult(projectApplicationToolResult(name, input, raw))
      expect(validator.getValidator(tools.find(tool => tool.name === name)!.outputSchema!)(result.structuredContent)).toMatchObject({ valid: true })
      expect(result.structuredContent).toMatchObject({ data: { target, comparison, contactSheet: { frames: [29, 30, 31] }, documentVersion: 'host:document:29' } })
    }
  })
  it('局部变化区域、复原时间与采样阶段经公共出口完整保留，拒绝未知字段', () => {
    const name = 'query_video_edit_content'; const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)!
    const screenChange = { beforeSeconds: 1, atSeconds: 1.2, lastChangeSeconds: 1.4, returnSeconds: 1.4, settledSeconds: 1.6,
      changedRatio: .05, region: { x: .1, y: .2, width: .3, height: .2 }, abrupt: true, kind: 'transient', samplingFps: 30, stage: 'refined' }
    const data = definition.outputSchema.parse({ ...successData[name], records: [{ id: 'screen:refined:0:0', kind: 'screen_change', text: '复原候选',
      textTruncated: false, ranges: [{ fromUs: 1200000, toUs: 1400000 }], rangeCount: 1, basis: 'analysis', precision: 'interval', originRef: ref('video_edit.item'), recordId: '0', sourceVerified: true, screenChange }] }) as Record<string, unknown>
    const raw = { ok: true, data: capabilityVerificationEnvelope(definition, input, data), ...revisions }
    const validate = validator.getValidator(tools.find(tool => tool.name === name)!.outputSchema!)
    const result = toMcpResult(projectApplicationToolResult(name, input, raw))
    expect(validate(result.structuredContent)).toMatchObject({ valid: true })
    expect(result.structuredContent).toMatchObject({ data: { records: [{ screenChange }] } })
    expect(definition.outputSchema.safeParse({ ...data, records: [{ ...(data.records as Record<string, unknown>[])[0], screenChange: { ...screenChange, unknown: true } }] }).success).toBe(false)
  })
  it('来源映射保留成片零帧的点证据，公共投影不会把它扩张或删除', () => {
    const name = 'query_video_edit_source_map'
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)!
    const data = definition.outputSchema.parse({ ...successData[name], records: [{
      id: 'video:sequence/clip:0:30', medium: 'video', kind: 'video', timeline: { fromFrame: 0, toFrame: 30 },
      path: [{ sequenceRef, clipRef, itemRef: ref('video_edit.item', 'document:item'), track: 0 }],
      sourceKind: 'media', mediaRef: ref('video_edit.media', 'document:media'),
      source: { fromUs: 0, toUs: 1000000, direction: 'forward', basis: 'sampled_envelope' }, firstSample: { frame: 0, sourceUs: 0 },
      content: { records: [{ record: { id: 'scene:0', kind: 'scene', text: '画面变化', textTruncated: false,
        ranges: [{ fromUs: 0, toUs: 0 }], rangeCount: 1, basis: 'analysis', precision: 'point',
        originRef: ref('video_edit.media', 'document:media'), recordId: '0', sourceVerified: true },
      timelineRanges: [{ fromFrame: 0, toFrame: 0 }] }], total: 1, nextCursor: null, complete: true },
    }] }) as Record<string, unknown>
    const raw = { ok: true, data: capabilityVerificationEnvelope(definition, input, data), ...revisions, revisionEpoch: 'host' }
    const validate = validator.getValidator(tools.find(tool => tool.name === name)!.outputSchema!)
    for (const options of [{}, { includeRevisions: true, includeEvidence: true, includeDetails: true }]) {
      const result = toMcpResult(projectApplicationToolResult(name, input, raw, options))
      expect(validate(result.structuredContent)).toMatchObject({ valid: true })
      expect(result.structuredContent).toMatchObject({ data: { records: [{ content: { records: [{ timelineRanges: [{ fromFrame: 0, toFrame: 0 }] }] } }] } })
    }
  })
  it.each(['external', 'embedded'] as const)('%s 的真实派发出口拒绝投影后多余字段', async kind => {
    const dispatcher = new ApplicationToolDispatcher({ assertActive() {}, access: () => ({ allowWrites: true, allowPaid: true, allowDestructive: true }) }, host, undefined, 0, kind)
    const execute = vi.spyOn(host, 'execute').mockResolvedValueOnce({ ok: true, data: { ...successData.read_application_entity, ref: { ...documentRef, unexpected: true } } })
    try {
      await expect(dispatcher.call('fixture', 'read_application_entity', { ref: documentRef }, new AbortController().signal)).rejects.toThrow('APPLICATION_OUTPUT_CONTRACT')
    } finally { execute.mockRestore() }
  })
  it('真实结果出口在测试中拒绝额外字段，生产只记录日志', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }
    expect(() => validateApplicationToolOutput('fixture', schema, { ok: true, extra: true }, 'test')).toThrow('APPLICATION_OUTPUT_CONTRACT')
    expect(() => validateApplicationToolOutput('fixture', schema, { ok: true, extra: true }, 'production')).not.toThrow()
    expect(contractLog).toHaveBeenLastCalledWith('应用工具返回不符合声明', expect.objectContaining({ event: 'application.output_contract.failed', context: expect.objectContaining({ capabilityId: 'fixture' }) }))
  })
  it('全部写工具允许等待确认的非错误回执，且不得缺少确认位置和恢复指引', async () => {
    const { applicationUserConfirmation } = await import('../../../../src/core/application-control/userConfirmation')
    const raw = { ok: false, operationId: '3e8b1d7c-6a2f-4c95-9d40-7f1e5a3c8b26', executionState: 'awaiting_user_confirmation' as const, verificationState: 'unresolved',
      confirmation: applicationUserConfirmation({ title: '费用确认', message: '按模型计费', confirmLabel: '确认' }) }
    for (const tool of tools.filter(tool => APPLICATION_WRITE_CAPABILITY_IDS.includes(tool.name))) {
      const result = toMcpResult(projectApplicationToolResult(tool.name, {}, raw))
      expect(result.isError).toBe(false)
      const validate = validator.getValidator(tool.outputSchema!)
      expect(validate(result.structuredContent).valid, tool.name).toBe(true)
      expect(validate({ ...result.structuredContent, confirmation: { title: '缺少说明' } }).valid, tool.name).toBe(false)
    }
  })
  for (const [name, data] of Object.entries(successData)) {
    it(`${name}：完整领域校验→公共 verification→紧凑/完整投影→MCP structuredContent`, () => {
      const tool = tools.find(tool => tool.name === name)!
      expect(tool?.outputSchema, name).toBeDefined()
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)!
      const parsed = definition.outputSchema.parse(data) as Record<string, unknown>
      const envelope = capabilityVerificationEnvelope(definition, input, parsed)
      const raw = APPLICATION_WRITE_CAPABILITY_IDS.includes(name)
        ? { ok: true, operationId: '3e8b1d7c-6a2f-4c95-9d40-7f1e5a3c8b26', executionState: 'completed' as const, verificationState: 'verified', result: { ok: true, data: envelope }, ...revisions }
        : { ok: true, data: envelope, ...revisions, revisionEpoch: 'host' }
      const validate = validator.getValidator(tool.outputSchema!)
      for (const options of [{}, { includeRevisions: true, includeEvidence: true, includeDetails: true }]) {
        const result = toMcpResult(projectApplicationToolResult(name, input, raw, options))
        const checked = validate(result.structuredContent)
        expect(checked.valid, JSON.stringify(checked)).toBe(true)
      }
    })
  }
  it('read_application_media：image 标准附件与 chunk 字节分别符合实际交付的 schema', () => {
    const schema = tools.find(tool => tool.name === 'read_application_media')!.outputSchema!
    const validate = validator.getValidator(schema)
    for (const data of [
      { mode: 'image', mimeType: 'image/jpeg', base64: 'aW1hZ2U=', offset: 0, byteLength: 26670, totalBytes: 645656, eof: true, width: 1280, height: 720 },
      { mimeType: 'audio/mpeg', base64: 'YXVkaW8=', offset: 0, byteLength: 63931, totalBytes: 63931, eof: true },
      { mimeType: 'audio/mpeg', base64: '', offset: 63931, byteLength: 0, totalBytes: 63931, eof: true },
    ]) {
      const result = toMcpResult(projectApplicationToolResult('read_application_media', {}, { ok: true, data }))
      expect(validate(result.structuredContent)).toMatchObject({ valid: true })
      if (data.mode === 'image') {
        expect(result.structuredContent.data).not.toHaveProperty('base64')
        expect(result.content[1]).toEqual({ type: 'image', data: data.base64, mimeType: data.mimeType })
      } else expect(result.structuredContent.data).toHaveProperty('base64', data.base64)
    }
  })
  it('严格输出继续拒绝未声明字段与错误 verified 类型，不能靠放宽 additionalProperties 修复', () => {
    for (const name of ['prepare_video_edit_subtitle_audio', 'observe_video_edit_frame']) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)!
      const data = capabilityVerificationEnvelope(definition, input, successData[name])
      const raw = name === 'prepare_video_edit_subtitle_audio' ? { ok: true, result: { ok: true, data } } : { ok: true, data }
      const validate = validator.getValidator(tools.find(tool => tool.name === name)!.outputSchema!)
      const withData = (changed: Record<string, unknown>) => name === 'prepare_video_edit_subtitle_audio' ? { ...raw, result: { ok: true, data: changed } } : { ...raw, data: changed }
      expect(validate(withData({ ...data, undeclared: true })).valid).toBe(false)
      expect(validate(withData({ ...data, verification: { ...(data.verification as Record<string, unknown>), verified: 'true' } })).valid).toBe(false)
      expect(validate(withData({ ...data, verification: { ...(data.verification as Record<string, unknown>), undeclared: true } })).valid).toBe(false)
    }
  })
  it('每个有 outputSchema 的工具均有代表性回执或逐项列出的未覆盖原因', () => {
    const covered = new Set([...Object.keys(successData), 'read_application_media'])
    const declared = tools.filter(tool => tool.outputSchema).map(tool => tool.name)
    expect(declared.filter(name => !covered.has(name))).toEqual(Object.keys(uncoveredTools).sort())
    expect(Object.keys(successData).filter(name => !declared.includes(name))).toEqual([])
    for (const [name, reason] of Object.entries(uncoveredTools)) expect(reason.length, name).toBeGreaterThan(20)
  })
})
