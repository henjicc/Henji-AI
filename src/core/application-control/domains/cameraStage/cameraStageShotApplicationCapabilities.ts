import { z } from 'zod'

import { capabilityOutputSchema, defineApplicationCapability } from '../shared/defineApplicationCapability'
import {
  CONFLICT_RECOVERY,
  cameraStageControl,
  cameraStageDocumentIdSchema,
  cameraStageTarget,
  cameraStageTransactionResultShape,
} from './cameraStageCapabilitySchemas'
import { cameraStageShotIntentShape, cameraStageShotResultShape, refineCameraStageShotIntent } from './cameraStageShotSchemas'

export const COMPOSE_CAMERA_STAGE_SHOT_CAPABILITY_ID = 'compose_camera_stage_shot'

export const composeCameraStageShotCapability = defineApplicationCapability({
  id: COMPOSE_CAMERA_STAGE_SHOT_CAPABILITY_ID,
  resolveOperationTargets: input => [{ kind: 'camera_stage.document', id: input.documentId }],
  version: 1,
  title: '按构图意图摆机位',
  description: '用景别、主体在画面中的位置、角度、焦距倾向和两人关系（单人、双人镜头、过肩、正反打一对）描述镜头，'
    + '应用求出机位、注视点和焦距，不用自己猜坐标。两人镜头默认守在轴线同一侧。'
    + '有遮挡时在意图允许的范围内换角度或换焦距距离并如实报告。'
    + '给 at 时只把机位记进那个时间点的状态关键帧：起点和终点各定一次，中间由平滑运动引擎接上。'
    + '结果读回实际构图：主体投影框、占画高比例与景别、左中右、视线留空、是否被挡及被谁挡。',
  domain: 'camera_stage',
  aliases: ['构图', '定机位', '摆机位', '景别', '三分法', '过肩', '正反打', '双人镜头', '轴线', '平视', '俯拍', '仰拍', '鸟瞰', 'framing', 'shot size', 'over the shoulder', 'compose shot'],
  readOnly: false, dataClasses: ['C1'], idempotent: true, destructive: false,
  timeoutMs: 20_000, supportsPreview: false, supportsUndo: true, requiredScopes: ['camera_stage'],
  acceptsRefs: ['camera_stage.document', 'camera_stage.camera', 'camera_stage.object', 'camera_stage.state_keyframe'],
  producesRefs: ['camera_stage.camera', 'camera_stage.state_keyframe'],
  successEvidence: ['结果 shots[] 给出每台摄像机的机位、注视点、焦距、实际构图读回（景别、画面位置、投影框、遮挡）；'
    + '意图机位被挡、钻地而改了角度或焦距，或过肩按两人间距改了焦距与景别时，附 adjusted（原因、挡住它的对象、改了什么）。'],
  failureRecovery: [
    CONFLICT_RECOVERY,
    '摄像机、主体或状态关键帧 id 不对时按错误里列出的可用 id 重试；摄像机已有运镜时传 at 只定那一刻。',
    'SHOT_NOT_REACHABLE 时按错误里说的原因改：钻地或落进对象就换角度、景别或主体位置；过肩两人离得太远就把两人拉近，或改用 two_shot、single。',
  ],
  inputSchema: z.object({ documentId: cameraStageDocumentIdSchema, ...cameraStageShotIntentShape }).strict().superRefine(refineCameraStageShotIntent),
  outputSchema: capabilityOutputSchema({ ...cameraStageTransactionResultShape, ...cameraStageShotResultShape }),
  resolveConcurrencyKey: (input) => `camera_stage:${input.documentId}`,
  resolveTargetIds: (input) => cameraStageTarget(input.documentId, { cameraId: input.cameraId }),
  control: cameraStageControl('execute', ['camera_stage.camera'], [
    'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
    'camera_stage.camera.fov', 'camera_stage.camera.look_at_target',
  ], ['camera_stage'], [
    { effect: 'create', entityTypes: ['camera_stage.state_keyframe'] },
    { effect: 'update', entityTypes: ['camera_stage.camera', 'camera_stage.state_keyframe'] },
  ]),
  summarize: (output) => `构图定机位事务 ${output.transactionRef} 已完成。`,
})
