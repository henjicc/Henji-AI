// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import type {
  ApplicationMutationExecutor,
  ApplicationStoreActionLedger,
} from '@/core/application-control'
import { auditStoreActionLedger } from '@/core/application-control'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/assistant/builtinApplicationCapabilityRegistry'
import { ASSET_STORE_LEDGER } from '@/features/assets/application/assetStoreLedger'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { CAMERA_STAGE_STORE_LEDGER } from '@/features/cameraStage/application/cameraStageStoreLedger'
import { useCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { CANVAS_STORE_LEDGER } from '@/features/canvas/application/canvasStoreLedger'
import { useCanvasStore } from '@/stores/canvasStore'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'

/**
 * 覆盖门禁：**人在界面上能做的每一件事，助手要么也能做，要么账上写明为什么不能。**
 *
 * 此前所有覆盖门禁都从「已注册的描述」出发做双向比对，从不反向看 store。于是三维场景外观
 * 24 项界面能改、助手一项都看不到这件事，没有任何检查能发现——不是被权限挡住，是根本没注册。
 *
 * 这里的断言方向是**从 store 运行时枚举**：任何新增的界面动作都会出现在 actionNames 里，
 * 账上没有就红。用运行时枚举而不是手写清单，是这条门禁的全部意义所在。
 */

interface LedgerCase {
  ledger: ApplicationStoreActionLedger<string>
  state: () => object
}

const LEDGERS: LedgerCase[] = [
  { ledger: CAMERA_STAGE_STORE_LEDGER, state: () => useCameraStageStore.getState() },
  { ledger: CANVAS_STORE_LEDGER, state: () => useCanvasStore.getState() },
  { ledger: ASSET_STORE_LEDGER, state: () => useAssetLibraryStore.getState() },
]

/**
 * 人机差集的燃尽基线：账上仍标为 gap 的动作总数。
 *
 * 这是个棘轮——新缺口进不来（超过基线就红），各期补齐把它往下调。降到 0 就是
 * 「助手能做的事等于人在界面上能做的事」。改这个数字只有两种正当理由：
 * 补齐了某项（调小），或者界面新增了一个确实还做不了的功能（连同 gap 理由一起说明）。
 *
 * 建账当天 21 项。播放控制 5 项已补齐（注册成 camera_stage.playback 单例实体，零新增工具），
 * 2.1 又烧掉镜头卡增删排序 3 项（removeShot/removeShots 接到集合写入，reorderShot 绑到已可写
 * 的 time 属性，专用能力 add_camera_stage_shot 一并下线）。2.2 烧掉镜头卡状态捕获 1 项
 * （captureIntoSelectedShot 绑到新增的 capture_object_refs 属性，不依赖选中态）。2.3 烧掉编辑
 * 模式切换与烘焙 2 项——读代码发现"专业→简易无约束"的假设不成立（store 直接拒绝这个方向），
 * setEditorMode 只是新建工程的内部步骤、已被 create_camera_stage_project 覆盖，改绑 excluded；
 * bakeToProMode 注册为带审批的语义能力 bake_camera_stage_to_pro。2.4 烧掉姿态直接写入 2 项——
 * updatePoseJoint 并入 63 条 animatable.* 逐分量属性（方案 C：轨道无关键帧写静态值，有关键帧
 * 等价于当前时间点打点，只在专业模式下可写），applyPosePreset 绑到新增的 pose_preset 枚举属性。
 * 2.5 烧掉三维最后 3 项——clearTrack 接到集合删除的轨道级引用（工程:对象:属性路径，不带时间）；
 * setShotSpatialPath/setShotPathAnchor 绑到 camera_stage.trajectory 新增的 5 条可写属性
 * （knots 等三条整条路径替换，start_position/end_position 挪相邻镜头卡快照）。**三维 11 项
 * 缺口全部归零**。现存 5 项，全部是画布（清空、解散分组、重做、分镜格子改与排序）。
 */
const GAP_BASELINE = 5

function actionNames(state: object): string[] {
  return Object.entries(state)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key)
}

function auditAll() {
  const registry = getApplicationReflectionRegistry()
  const engine = getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
    collectionExecutors: Map<string, unknown>
  }
  const writable = new Set<string>()
  for (const executor of engine.mutationExecutors.values()) {
    for (const propertyId of executor.writableProperties) writable.add(propertyId)
  }
  const declaredCollections = new Set(registry
    .describe({}, {
      exposure: 'assistant' as const,
      permissions: new Set(registry.listDeclaredPropertyPermissions()),
      acceptedDataClasses: new Set(['C0', 'C1', 'C2'] as const),
    }).entities
    .filter((entity) => entity.collectionWrite)
    .map((entity) => entity.id)
    .filter((entityType) => engine.collectionExecutors.has(entityType)))
  const capabilityIds = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map((capability) => capability.id))

  return LEDGERS.map(({ ledger, state }) => ({
    ledger,
    audit: auditStoreActionLedger({
      ledger,
      actionNames: actionNames(state()),
      writableProperties: writable,
      collectionEntityTypes: declaredCollections,
      capabilityIds,
    }),
  }))
}

describe('界面动作与助手能力对齐', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('这条门禁不会因为账本或 store 为空而空转', () => {
    const results = auditAll()
    expect(results.length).toBeGreaterThanOrEqual(3)
    for (const { ledger, audit } of results) {
      const total = Object.keys(ledger.entries).length
      expect(total, `${ledger.title}账本为空`).toBeGreaterThan(0)
      expect(
        audit.unclassified.length + audit.stale.length + total,
        `${ledger.title}的 store 动作枚举为空，门禁失效`,
      ).toBeGreaterThan(0)
    }
  })

  it('界面上能做的每一个动作，账上都有一条', () => {
    for (const { ledger, audit } of auditAll()) {
      expect(
        audit.unclassified,
        `【${ledger.title}】以下 store 动作界面能做、账上没有——它是助手做不了却没人知道的能力缺口。`
        + `要么绑定到属性 / 集合 / 能力，要么进 excluded 写明由谁维护，要么标成 gap 写明缺什么：`
        + audit.unclassified.join('、'),
      ).toEqual([])
    }
  })

  it('账上每一条都对得上真实的 store 动作', () => {
    for (const { ledger, audit } of auditAll()) {
      expect(
        audit.stale,
        `【${ledger.title}】以下账目对应的 store 动作已不存在，账没销：${audit.stale.join('、')}`,
      ).toEqual([])
    }
  })

  it('账上写的助手入口真的存在，而且真的写得了', () => {
    for (const { ledger, audit } of auditAll()) {
      const problems = audit.brokenBindings.map((item) => item.problem)
      expect(
        problems,
        `【${ledger.title}】以下账目指向的属性 / 实体 / 能力对不上，账是假的：${problems.join('；')}`,
      ).toEqual([])
    }
  })

  it('排除与缺口的理由都能被验证', () => {
    for (const { ledger, audit } of auditAll()) {
      const problems = audit.weakExclusions.map((item) => item.problem)
      expect(
        problems,
        `【${ledger.title}】以下理由无法验证（过短，或把问题推给将来）：`
        + problems.join('；'),
      ).toEqual([])
    }
  })

  it('人机差集不许扩大：gap 总数不超过基线', () => {
    const results = auditAll()
    const gaps = results.flatMap(({ ledger, audit }) => audit.gaps.map((action) => `${ledger.storeId}.${action}`))
    expect(
      gaps.length,
      `人能做、助手还不能做的动作涨到了 ${gaps.length} 个（基线 ${GAP_BASELINE}）：${gaps.join('、')}。`
      + '新功能上线时助手侧要同步接上；确实要留缺口就连同理由一起把基线调高。',
    ).toBeLessThanOrEqual(GAP_BASELINE)
  })
})
