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
import { BUILTIN_STYLE_KITS } from '../../../../src/core/videoEdit/styleKitPresets'
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
  get_video_edit_clip_pauses: { clipRef, source: 'words', pauses: [{ startFrame: 30, endFrame: 42, durationMs: 200, kind: 'breath' }], words: [{ text: '你好', startFrame: 0, endFrame: 30 }], message },
  translate_video_edit_subtitles: { documentRef, captionRefs: [ref('video_edit.caption')], ...verified },
  segment_video_edit_subtitles: { documentRef, captionRefs: [ref('video_edit.caption')], createdCaptionRefs: [ref('video_edit.caption')], updatedCaptionRefs: [ref('video_edit.caption')], removedCaptionRefs: [], ...verified },
  observe_video_edit_frame: { byteLength: 26670, resultRef: assetRef, documentRef, target: { kind: 'program', sequenceRef, frame: 60 }, width: 1280, height: 720, sourceWidth: 1920, sourceHeight: 1080, documentRevision: 29, documentVersion: 'host:document:29', message, verification: { verified: true, condition: '已保存合成帧', target: assetRef } },
  analyze_video_edit_color: { resultRef: clipRef, parameters: { exposure: 0 }, frame: 60, frames: [60], documentRevision: 29, documentVersion: 'host:document:29', message },
  analyze_video_edit_beats: { resultRef: documentRef, markerRefs: [ref('video_edit.marker')], ...verified },
  apply_video_edit_title_template: { resultRef: documentRef, clipRefs: [clipRef], ...verified },
  generate_video_edit_title_from_description: { resultRef: documentRef, clipRefs: [clipRef], ...verified },
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
  download_canvas_media: { documentId: 'canvas', savedNodeIds: ['node'], failedNodeIds: [], requestedCount: 1, destinationMode: 'quick', ...revisions },
  submit_canvas_node_generation: { taskId: 'task', status: 'submitted', ...revisions },
  resume_canvas_generation_task: { taskId: 'task', status: 'success', task: { status: 'success' }, ...revisions },
  retry_layer_stack_result: { nodeRef: ref('canvas.node', 'canvas:layers'), status: 'retrieving', resultRefs: [nodeRef], ...revisions },
  retry_audio_edit_save: { resultRef: audioDocumentRef, ...verified },
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
  insert_video_edit_style_component: { resultRef: documentRef, clipRefs: [clipRef], itemRefs: [ref('video_edit.item')], definitionRefs: [ref('video_edit.code_material')], versionRefs: [ref('video_edit.code_version')], trackRefs: [ref('video_edit.track')], styleRef: ref('video_edit.style_kit'), sequenceRef, styleEffect: 'create', ...verified },
}

// 录制服务的会话控制、事件分页、理解/隐私、导入与成片回执；与各领域结果测试保持同形。
const recordingRef = ref('screen_recording.session', '3e8b1d7c-6a2f-4c95-9d40-7f1e5a3c8b26')
const understandingRef = ref('screen_recording.understanding', recordingRef.id)
for (const action of ['start', 'pause', 'resume', 'mark', 'stop', 'cancel', 'recover']) {
  successData[`${action}_screen_recording`] = { resultRef: recordingRef, ...verified, ...revisions }
}
successData.read_screen_recording_events = { events: [{ kind: 'control', action: 'stop', eventId: 'stop', monoUs: 13000000, recordingUs: 10000000, seq: 1, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static' }], nextOffset: null, message, ...revisions }
successData.import_screen_recording = { resultRef: documentRef, itemIds: ['screen', 'mic'], ...verified, ...revisions }
successData.understand_screen_recording = { resultRef: understandingRef, steps: 1, candidates: 2, audioUpdates: [{ ref: audioDocumentRef, created: true, transcribed: true }], undoRef: 'understanding-undo', ...verified, ...revisions }
successData.detect_screen_recording_sensitive_text = { resultRef: understandingRef, candidates: 1, undoRef: 'privacy-undo', ...verified, ...revisions }
successData.generate_screen_recording_movie = { documentRef, resultRef: sequenceRef, sequenceRefs: [sequenceRef], warnings: [], verified: true }
successData.generate_video_edit_screen_attention = { documentRef, resultRef: sequenceRef, clipRefs: [clipRef], created: false, quietFrames: 30, impreciseCapabilities: 1, ...verified }
successData.detect_video_edit_sensitive_text = { resultRef: clipRef, effectRefs: [ref('video_edit.effect', 'document:clip:privacy')], ...verified }
const taskObservation = { taskRef: ref('camera_stage.render_task', 'task'), status: 'completed', revisions: { camera_stage: 1 }, phase: null, progress: 1, outputKind: 'image', message, resultRefs: [nodeRef], recovery: null, ...revisions }
successData.get_camera_stage_render_task = taskObservation
successData.wait_camera_stage_render_task = { ...taskObservation, waitReason: 'terminal' }
successData.recover_camera_stage_render_task = { ...taskObservation, recoveryAttempted: true }
const transaction = { status: 'completed', transactionRef: 'transaction', undoRef: 'undo', verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: new Date(0).toISOString() }, resultingRevisions: { 'video_edit:document': 29 }, resultRefs: [documentRef], effects: [], evidence: [], ...revisions }
for (const name of ['change_application_entities', 'undo_application_changes']) successData[name] = transaction
for (const name of ['apply_camera_stage_camera_move', 'place_camera_stage_object']) successData[name] = { ...transaction }
const generationPlan = { action: 'generate_shot', sequenceRef, startSeconds: 1, durationSeconds: 5, trackRef: null, placement: 'add', references: [] }
successData.generate_video_edit_in_place = { documentRef, taskRef: ref('generation.task', 'task'), plan: generationPlan, status: 'submitted', verified: true, message }
successData.prepare_video_edit_in_place_generation = { documentRef, plan: generationPlan, preparation: { prepared: true, modelId: 'fixture-model', providerId: 'fixture', mediaType: 'video', options: {} }, message }
for (const name of ['export_video_edit', 'query_video_edit_export', 'cancel_video_edit_export']) {
  successData[name] = { resultRef: documentRef, message, verification: verification(), queue: [], task: { id: 'export', state: 'completed', progress: 1, revision: 29, startFrame: 0, endFrame: 60 } }
}
successData.query_video_edit_export = { resultRef: documentRef, message, verification: verification(), queue: [], total: 0, nextCursor: null }

for (const name of ['measure_video_edit_loudness', 'normalize_video_edit_loudness']) {
  successData[name] = { resultRef: documentRef, results: [{ clipRef, volume: 1, measurement: { integratedLufs: -16, shortTermLufs: -15, truePeakDbtp: -1, samplePeakDbfs: -2, durationSeconds: 5 } }], ...verified }
}
for (const name of ['extract_video_edit_work_style', 'extract_video_edit_reference_style']) {
  successData[name] = { name: '作品风格', content: { tokens: BUILTIN_STYLE_KITS[0].tokens, rules: BUILTIN_STYLE_KITS[0].rules, samples: BUILTIN_STYLE_KITS[0].samples }, message }
}
for (const domain of ['image_edit', 'video_edit']) {
  for (const action of ['organize', 'interpret']) successData[`${action}_${domain}_intent`] = { resultRef: ref(`${domain}.intent_draft`), candidateRefs: [ref(`${domain}.intent_candidate`)], status: 'candidate', questions: [], ...revisions }
  successData[`read_${domain}_intent_recording`] = { resultRef: domain === 'video_edit' ? documentRef : imageDocumentRef, lines: ['{"text":"请缩短片头"}'], nextOffset: null, nextImageOffset: null, semanticImages: [], inputReceipt: 'receipt', ...revisions }
}
for (const name of ['import_video_edit_asset', 'import_video_edit_folder', 'save_video_edit', 'split_video_edit', 'trim_video_edit_clip', 'undo_video_edit', 'redo_video_edit']) {
  successData[name] = { resultRef: documentRef, message, verification: verification() }
}
for (const name of ['collect_video_edit_code_asset', 'collect_video_edit_output']) {
  successData[name] = { resultRef: assetRef, documentRef, message, verification: verification(assetRef) }
}
for (const name of ['create_video_edit_multicam', 'auto_switch_video_edit_multicam']) {
  successData[name] = { resultRef: documentRef, sequenceRef, itemRef: ref('video_edit.item'), clipRefs: [clipRef], message, verification: verification() }
}
// 正式文档处理器的 verifyDocument/项目回执及生成取消回执已自行核实，并带 target。
// 它们属于 passthrough 领域输出，公共桥接须保留，公共 schema 也必须明确声明。
for (const name of ['create_document', 'open_document', 'move_document', 'duplicate_document', 'collect_document_media', 'trash_document', 'create_project', 'trash_project', 'export_document_package', 'cancel_generation_task']) {
  const data = successData[name]
  const target = name === 'cancel_generation_task' ? ref('generation.task', 'task')
    : name === 'export_document_package' ? ref('documents.document') : data.resultRef as { kind: string; id: string }
  successData[name] = { ...data, verification: verification(target) }
}
for (const name of ['ripple_delete_video_edit_text', 'extract_video_edit_text', 'insert_video_edit_text', 'detect_video_edit_text_silence']) {
  successData[name] = { documentRef, resultRef: sequenceRef, ranges: [{ from: 0, to: 60 }], changed: true, ...verified }
}
for (const name of ['reset_audio_edit', 'format_audio_edit_subtitles', 'quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'transcribe_audio_edit', 'process_audio_edit_sound', 'export_audio_edit', 'query_audio_edit_tasks', 'cancel_audio_edit_task']) {
  successData[name] = { resultRef: audioDocumentRef, ...verified, count: 1, shortenedMs: 100, durationFrames: 2400, tasks: [{ requestId: 'task', documentId: 'audio', kind: 'processing', state: 'completed', progress: 100 }] }
}

const host = new ApplicationHostBridge(() => {})
const tools = buildApplicationToolCatalog({ tools: host.tools(), access: { allowWrites: true, allowPaid: true, allowDestructive: true }, operationsEnabled: true, includeSkillTool: true }).tools
const validator = applicationOutputValidator
// 本轮有 outputSchema 的工具均有回执；未来不可构造的工具必须逐个登记具体原因，不能按域豁免。
const uncoveredTools: Record<string, string> = {}

describe('外部客户端成功输出 JSON Schema 契约', () => {
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
