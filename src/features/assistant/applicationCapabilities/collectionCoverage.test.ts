// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'

/**
 * 覆盖门禁：**声明了可增删的实体类型，必须真的有集合执行器**。
 *
 * 这是「一个个手写适配」这类问题的自动化拦截点。反射层的通用动词只有在两侧都齐的时候才成立：
 * 实体描述里声明 `collectionWrite`，执行器那边注册对应实现。少哪一半，助手都会在运行时撞墙——
 * 而运行时撞墙的代价你已经付过好几次了：错误信息看不出跟能力覆盖有关，只能靠一次次实机跑。
 *
 * 两个方向都检查：声明与执行器任一侧单独存在，都会形成不可达能力或死代码。
 */

const accessContext = {
  exposure: 'assistant' as const,
  permissions: new Set<string>(),
  acceptedDataClasses: new Set(['C0', 'C1', 'C2', 'C3'] as const),
}

describe('集合写入覆盖一致', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('声明了 collectionWrite 的实体都有集合执行器', () => {
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine()
    const declared = registry.describe({}, accessContext).entities
      .filter((entity) => entity.collectionWrite)
      .map((entity) => entity.id)

    // 保证这条用例不会因为一个都没声明而变成空转
    expect(declared.length).toBeGreaterThan(0)

    const missing = declared.filter((entityType) => {
      const engineWithInternals = engine as unknown as {
        collectionExecutors: Map<string, unknown>
      }
      return !engineWithInternals.collectionExecutors.has(entityType)
    })
    expect(missing, `以下实体声明了可增删但没有集合执行器：${missing.join('、')}`).toEqual([])
  })

  it('属性可写声明与 mutation 执行器双向一致', () => {
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine() as unknown as {
      mutationExecutors: Map<string, unknown>
    }
    const entities = registry.describe({}, accessContext).entities
    const declaredWritable = entities.filter((entity) => registry.listProperties(entity.id).some((property) => (
      !property.readOnlyReason && property.requiredPermissions.write.length > 0
    ))).map((entity) => entity.id)
    const missingExecutors = declaredWritable.filter((entityType) => !engine.mutationExecutors.has(entityType))
    const deadExecutors = [...engine.mutationExecutors.keys()].filter((entityType) => !declaredWritable.includes(entityType))

    expect(
      missingExecutors,
      `以下实体声明了可写属性但没有 mutation 执行器：${missingExecutors.join('、')}`,
    ).toEqual([])
    expect(
      deadExecutors,
      `以下实体注册了 mutation 执行器但没有任何可写属性：${deadExecutors.join('、')}`,
    ).toEqual([])
  })

  it('集合写入声明与 collection 执行器双向一致', () => {
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine() as unknown as {
      collectionExecutors: Map<string, unknown>
    }
    const declared = registry.describe({}, accessContext).entities
      .filter((entity) => entity.collectionWrite)
      .map((entity) => entity.id)
    const deadExecutors = [...engine.collectionExecutors.keys()].filter((entityType) => !declared.includes(entityType))
    expect(
      deadExecutors,
      `以下实体注册了 collection 执行器但没有 collectionWrite 声明：${deadExecutors.join('、')}`,
    ).toEqual([])
  })

  it('通用适配器所需领域权限完全来自反射属性声明', () => {
    const registry = getApplicationReflectionRegistry()
    const declared = registry.describe({}, {
      ...accessContext,
      permissions: new Set(registry.listDeclaredPropertyPermissions()),
    }).properties.flatMap((property) => [
      ...property.requiredPermissions.read,
      ...property.requiredPermissions.write,
    ])
    expect(registry.listDeclaredPropertyPermissions()).toEqual([...new Set(declared)].sort())
  })

  /**
   * 覆盖率门禁：**每个实体要么能写，要么写明为什么不能写**。
   *
   * 没有这条时，「某个领域忘了接执行器」和「这个实体有意只读」在机器看来完全一样，只能靠人
   * 记住——本项目已经因此吃过多次亏：能力其实存在、模型也知道该调什么，但没人把它接上，
   * 直到用户实测才发现。
   */
  it('每个实体要么有写入执行器，要么写明排除原因', () => {
    const registry = getApplicationReflectionRegistry()
    const engine = getApplicationControlExecutionEngine() as unknown as {
      mutationExecutors: Map<string, unknown>
      collectionExecutors: Map<string, unknown>
    }
    const uncovered = registry.describe({}, accessContext).entities.filter((entity) => (
      !engine.mutationExecutors.has(entity.id)
      && !engine.collectionExecutors.has(entity.id)
      && !entity.writeExclusion
    ))
    expect(
      uncovered.map((entity) => `${entity.domain}/${entity.id}`),
      '以下实体既没有写入执行器，也没有 writeExclusion.reason：要么补执行器，要么写明该状态由谁维护',
    ).toEqual([])
  })

  it('排除原因必须说明由谁维护，不接受敷衍表述', () => {
    const excluded = getApplicationReflectionRegistry().describe({}, accessContext).entities
      .filter((entity) => entity.writeExclusion)
    expect(excluded.length).toBeGreaterThan(0)
    for (const entity of excluded) {
      const reason = entity.writeExclusion?.reason ?? ''
      expect(reason.length, entity.id).toBeGreaterThan(10)
      expect(reason, entity.id).not.toMatch(/暂时|暂不|以后再|待定/)
    }
  })

  it('三维关键帧已经是可增删的实体', () => {
    const keyframe = getApplicationReflectionRegistry()
      .describe({ entityTypes: ['camera_stage.keyframe'] }, accessContext).entities[0]
    expect(keyframe?.collectionWrite).toMatchObject({ creatable: true, removable: true })
    // 必填属性缺一不可：少了任何一个，写出来的关键帧都落不到正确的轨道上
    expect(keyframe?.collectionWrite?.requiredPropertyIds).toEqual(expect.arrayContaining([
      'camera_stage.keyframe.object_ref',
      'camera_stage.keyframe.property_path',
      'camera_stage.keyframe.time',
      'camera_stage.keyframe.value',
    ]))
  })
})
