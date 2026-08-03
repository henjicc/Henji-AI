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
 * 反过来的方向不查：注册了执行器却没声明 `collectionWrite`，只是能力没开放，不会让任务失败。
 */

const accessContext = {
  exposure: 'assistant' as const,
  permissions: new Set<string>(),
  acceptedDataClasses: new Set(['C0', 'C1', 'C2', 'C3']),
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
