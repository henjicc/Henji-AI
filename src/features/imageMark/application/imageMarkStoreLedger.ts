import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

/*
 * 这份账本挂的是 6.1 产出的 imageEditSessionStore（src/features/imageEdit/store/），
 * 不是任务文档最初设想的 imageMark 自己的 store——6.1 执行时发现标注文档的状态早就
 * 统一收在图片编辑会话层，三宿主共用同一份，不存在一个只属于 imageMark 的独立 store。
 * storeId 必须等于*store 文件*的 basename（check-assistant-capabilities.cjs 的规则），
 * 与这份账本文件本身放在哪个 feature 目录无关；放在 imageMark/application/ 下是因为
 * "标注编辑器对助手可见"这件事（Reflection+StoreLedger 同时存在）按 feature 目录清点，
 * 需要在 src/features/imageMark/ 下能同时找到两者。
 */
type State = ReturnType<typeof useImageEditSessionStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const LIFECYCLE_REASON = '内部：hook 挂载/卸载时的会话生命周期管理（StrictMode 下幂等），'
  + '不是用户在界面上能触发的独立动作。'

export const IMAGE_MARK_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'imageEditSessionStore',
  title: '图片标注编辑会话',
  entries: {
    /*
     * 三条文档属性（旋转/镜像/裁剪）与标注集合写入（新建/删除标注）最终都调用同一个
     * commitDocument 原语——这里选择归到 image_mark.document 的三条属性，annotation
     * 那侧的集合写入覆盖由它自己的 collectionWrite 声明 + ImageMarkAnnotationCollectionExecutor
     * 独立审计（collectionCoverage.test.ts），不要求这里同时出现 kind:'collection' 绑定。
     */
    commitDocument: {
      kind: 'property',
      propertyIds: [
        'image_mark.document.orientation_rotate',
        'image_mark.document.orientation_mirrored',
        'image_mark.document.crop_rect',
      ],
    },
    updateDocumentWithoutHistory: {
      kind: 'excluded',
      category: 'internal',
      reason: '连续指针交互（拖拽标注、调整裁剪框）的中间帧，不产生历史记录；'
        + '最终态由 commitDocument 落地，助手写目标属性值即可，不需要模拟每一帧拖拽。',
    },
    pushHistorySnapshot: {
      kind: 'excluded',
      category: 'internal',
      reason: '事务开始前把当前文档存进撤销栈的记账步骤，由 commitTransaction 内部调用，不是独立用户动作。',
    },
    ensureSession: { kind: 'excluded', category: 'internal', reason: LIFECYCLE_REASON },
    disposeSession: { kind: 'excluded', category: 'internal', reason: LIFECYCLE_REASON },
    undo: { kind: 'capability', capabilityId: 'undo_image_mark_change' },
    redo: { kind: 'capability', capabilityId: 'redo_image_mark_change' },
  },
}
