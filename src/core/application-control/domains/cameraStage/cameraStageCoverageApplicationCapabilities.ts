import { z } from 'zod'

import { capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import {
  CONFLICT_RECOVERY,
  cameraStageControl,
  cameraStageDocumentIdSchema,
  cameraStageTarget,
  cameraStageTransactionResultShape,
} from './cameraStageCapabilitySchemas'
import {
  cameraStageCheckIntentShape,
  cameraStageCoverageIntentShape,
  cameraStageCoverageResultShape,
  cameraStageCutIntentShape,
  cameraStageCutResultShape,
  cameraStageEditCheckShape,
  refineCameraStageCoverage,
  refineCameraStageLines,
} from './cameraStageCoverageSchemas'

export const COVER_CAMERA_STAGE_SCENE_CAPABILITY_ID = 'cover_camera_stage_scene'
export const CUT_CAMERA_STAGE_COVERAGE_CAPABILITY_ID = 'cut_camera_stage_coverage'
export const CHECK_CAMERA_STAGE_EDIT_CAPABILITY_ID = 'check_camera_stage_edit'

const rangeRefine = (input: { startTime?: number; endTime?: number }, context: z.RefinementCtx): void => {
  if (input.startTime !== undefined && input.endTime !== undefined && input.endTime <= input.startTime) {
    context.addIssue({ code: 'custom', path: ['endTime'], message: 'endTime 必须晚于 startTime' })
  }
}

export const coverCameraStageSceneCapability = defineApplicationCapability({
  id: COVER_CAMERA_STAGE_SCENE_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1,
  title: '布置多机位覆盖',
  description: '给一段戏（谁、哪段时间、谁在什么时候说话）一次布置一套机位：建立镜头、主镜头、过肩正反打一对、每人一台近景，'
    + '可选每人一台反应特写和一台插入特写。机位按构图意图求解（同 compose_camera_stage_shot），全部守在两人连线的同一侧，'
    + '整条时间轴静止不动，切机位时不影响任何运动。结果读回每台机位的实际构图和拍得到主体的时段，并把这组覆盖记进镜头参考，'
    + '之后用 cut_camera_stage_coverage 按节拍剪成切镜序列。一次调用一个撤销点。',
  domain: 'camera_stage',
  aliases: ['多机位', '覆盖', '机位覆盖', '布置机位', '对话机位', '正反打', '主镜头', '建立镜头', '反应镜头', '插入镜头', 'coverage', 'multi camera', 'master shot'],
  readOnly: false, dataClasses: ['C1'], idempotent: false, destructive: false,
  timeoutMs: 60_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.object', 'camera_stage.camera'],
  producesRefs: ['camera_stage.camera'],
  successEvidence: ['结果 setups[] 是写入后读回的每台机位：镜头角色、实际构图（景别、画面位置、遮挡）、在轴线哪一侧、拍得到主要主体的时段 visibleSpans。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '主体或插入对象 id 不对时按错误里列出的可用 id 重试；SHOT_NOT_REACHABLE 时去掉那个镜头或把两人拉开一些。',
    'visibleSpans 很短的机位（主体走开了）可以换 referenceTime 再布一组，或在那段用主镜头和建立镜头。',
  ],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageCoverageIntentShape }).strict().superRefine(refineCameraStageCoverage),
  outputSchema: capabilityOutputSchema({ ...cameraStageTransactionResultShape, ...cameraStageCoverageResultShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  control: cameraStageControl('create', ['camera_stage.camera'], [
    'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation', 'camera_stage.camera.fov', 'camera_stage.camera.look_at_target',
  ], ['camera_stage'], [
    { effect: 'update', entityTypes: ['camera_stage.camera'] },
  ]),
  summarize: (output) => `多机位覆盖事务 ${output.transactionRef} 已完成。`,
})

export const cutCameraStageCoverageCapability = defineApplicationCapability({
  id: CUT_CAMERA_STAGE_COVERAGE_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1,
  title: '按节拍剪辑切机位',
  description: '把一组多机位覆盖按剧情节拍剪成切镜序列，写进时间轴的机位轨（只换拍摄机位，人物动作照常连续）。'
    + '剪辑规则：开场先建立再推近，景别逐步变化；相邻两镜不越轴；相邻两镜机位夹角至少 30° 或景别差两档以上，否则算跳切；'
    + '在转身、坐下、走动的中段切（动作剪辑点）；换人说话时切到说话人或听的人的反应；镜头时长守住快、中、慢节奏的上下限；'
    + '只用拍得到主体的机位。结果列出每一镜（时段、机位、景别、为什么用它）和规则检查（同 check_camera_stage_edit）。一次调用一个撤销点。',
  domain: 'camera_stage',
  aliases: ['剪辑', '切机位', '切镜头', '自动剪辑', '切镜序列', '剪成片', '多机位剪辑', 'edit', 'cut', 'multicam edit'],
  readOnly: false, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 60_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.camera', 'camera_stage.camera_cut'],
  producesRefs: ['camera_stage.camera_cut'],
  successEvidence: ['结果 shots[] 是写入后按机位轨与实际画面读回的每一镜；violations[] 是写入后的规则检查，空表示全部规则通过。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '覆盖 id 不对时按错误里列出的覆盖重试；覆盖里的摄像机都删了就先 cover_camera_stage_scene 重新布置。',
    '还有违规时按 suggestion 改：换节奏、补镜头（cover_camera_stage_scene 加 reaction 或 insert）、或用 change_application_entities 改个别 camera_stage.camera_cut。',
  ],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageCutIntentShape }).strict().superRefine((input, context) => {
    rangeRefine(input, context)
    refineCameraStageLines(input.lines, context)
  }),
  outputSchema: capabilityOutputSchema({ ...cameraStageTransactionResultShape, ...cameraStageCutResultShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  control: cameraStageControl('create', ['camera_stage.camera_cut'], [], ['camera_stage'], [
    { effect: 'delete', entityTypes: ['camera_stage.camera_cut'] },
  ]),
  summarize: (output) => `剪辑事务 ${output.transactionRef} 已完成。`,
})

export const checkCameraStageEditCapability = defineApplicationCapability({
  id: CHECK_CAMERA_STAGE_EDIT_CAPABILITY_ID,
  version: 1,
  title: '检查剪辑规则',
  description: '对时间轴机位轨上已有的切镜序列逐条跑剪辑规则，按实际机位与画面量出来，不看意图：越轴（180°）、跳切（夹角 < 30° 且景别差不到两档）、'
    + '动作剪辑点（切在动作开头或结尾）、说话人（换人说话时画面里没有说话人也不是反应镜头）、镜头时长、开场建立、景别跳变、主体出画或被挡。'
    + '每条违规给出哪两镜、违反哪条与改法，供自检后修正。只读。',
  domain: 'camera_stage',
  aliases: ['检查剪辑', '剪辑规则', '越轴', '跳切', '180度规则', '30度规则', '动作剪辑点', 'check edit', 'continuity check'],
  readOnly: true, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 30_000, supportsPreview: false, supportsUndo: false, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.camera_cut'],
  producesRefs: [],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageCheckIntentShape }).strict().superRefine(rangeRefine),
  outputSchema: capabilityOutputSchema({ documentId: z.string(), startTime: z.number(), endTime: z.number(), ...cameraStageEditCheckShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}:observe`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId),
  control: cameraStageControl('observe', ['camera_stage.camera_cut', 'camera_stage.camera']),
  summarize: (output) => output.summary,
})

export const CAMERA_STAGE_COVERAGE_APPLICATION_CAPABILITIES = [
  coverCameraStageSceneCapability,
  cutCameraStageCoverageCapability,
  checkCameraStageEditCapability,
]
