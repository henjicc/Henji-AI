// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import type { ApplicationMutationExecutor } from '@/core/application-control'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'

/**
 * 覆盖门禁：**声明可写的每一条属性，执行器必须真的写得了**。
 *
 * 兄弟门禁 collectionCoverage 只到**实体**粒度——实体有 mutation 执行器就算过。于是
 * `camera_stage.shot.time` 在反射层声明可写、执行器那条手写 if-else 链里没有对应分支这件事，
 * 全绿了不知道多久：助手改镜头时间点必然拿到 PROPERTY_NOT_WRITABLE，而这条错误在结算链上
 * 看不出跟能力覆盖有关，只能靠用户实机撞上。
 *
 * 两个方向都查：
 * - 声明可写、执行器写不了 → 助手撞墙的能力，用户会当成"助手不行"
 * - 执行器能写、反射层没声明 → 模型看不见，永远不会调用，是死代码
 */

function mutationExecutors(): Map<string, ApplicationMutationExecutor> {
  return (getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
  }).mutationExecutors
}

/*
 * 两个必须照抄的细节，抄错门禁会静默空转：
 * - 用 describe() 而不是 listProperties()：后者不过滤 exposures / dataClass，会把只给界面看的
 *   敏感设置项算成"声明可写"，误报一批不存在的缺口。
 * - permissions 必须来自 listDeclaredPropertyPermissions()：空权限集会被 canReadProperty 全滤掉，
 *   门禁于是永远拿到空数组、永远绿。
 */
function describeAll() {
  const registry = getApplicationReflectionRegistry()
  return registry.describe({}, {
    exposure: 'assistant' as const,
    permissions: new Set(registry.listDeclaredPropertyPermissions()),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2'] as const),
  })
}

/** 反射层认为「这条属性助手可以写」的判断，与执行引擎 preflight 用的是同一个口径。 */
function declaredWritable(entityType: string): Set<string> {
  return new Set(describeAll().properties
    .filter((property) => (
      property.entityType === entityType
      && !property.readOnlyReason
      && property.requiredPermissions.write.length > 0
    ))
    .map((property) => property.id))
}

describe('属性级写入覆盖一致', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('这条门禁不会因为没有执行器或没有属性而空转', () => {
    const executors = mutationExecutors()
    expect(executors.size).toBeGreaterThanOrEqual(6)
    const total = [...executors.values()].reduce((sum, executor) => sum + executor.writableProperties.size, 0)
    expect(total).toBeGreaterThan(50)
  })

  it('反射层声明可写 ↔ 执行器 writableProperties 双向一致', () => {
    for (const [entityType, executor] of mutationExecutors()) {
      const declared = declaredWritable(entityType)
      const implemented = executor.writableProperties

      const missing = [...declared].filter((id) => !implemented.has(id)).sort()
      const dead = [...implemented].filter((id) => !declared.has(id)).sort()

      expect(
        missing,
        `【${entityType}】以下属性在反射层声明为可写，执行器却写不了——助手改它会拿到 `
        + `PROPERTY_NOT_WRITABLE，而这条错误在结算链上看不出跟能力覆盖有关：${missing.join('、')}`,
      ).toEqual([])
      expect(
        dead,
        `【${entityType}】以下属性执行器能写，反射层却没声明——模型看不见，永远不会调用，`
        + `是死代码：${dead.join('、')}`,
      ).toEqual([])
    }
  })

  it('每条可写属性都声明了它接受的 operation', () => {
    for (const [entityType, executor] of mutationExecutors()) {
      const undeclared = [...executor.writableProperties]
        .filter((id) => !executor.propertyOperations.has(id)).sort()
      expect(
        undeclared,
        `【${entityType}】以下属性能写但没声明支持哪些 operation，模型只能试错：${undeclared.join('、')}`,
      ).toEqual([])

      const empty = [...executor.propertyOperations.entries()]
        .filter(([, operations]) => operations.size === 0).map(([id]) => id).sort()
      expect(
        empty,
        `【${entityType}】以下属性声明的 operation 集合为空，等于声明了一条谁都调不通的属性：${empty.join('、')}`,
      ).toEqual([])
    }
  })

  it('集合归属这类非 set 属性保留了它真正接受的 operation', () => {
    // 全项目唯一不走 set 的属性。它退化成 set 不会有任何测试失败，但助手从此加不了集合——
    // 所以在这里钉死，顺带作为「operations 声明确实有人用」的存在性证明。
    const asset = mutationExecutors().get('asset')
    expect(asset).toBeDefined()
    expect([...(asset?.propertyOperations.get('asset.library_refs') ?? [])].sort())
      .toEqual(['append', 'remove'])
  })
})
