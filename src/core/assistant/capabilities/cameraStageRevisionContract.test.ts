import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITIES } from '../builtinApplicationCapabilityRegistry'

/**
 * 三维写入靠 `baseRevision` 做乐观并发。要让模型能连续写入而不是每写一次就重读一次工程，
 * **每个写能力都必须收 `baseRevision`，也必须回带写入后的 `baseRevision`**。
 *
 * 实测踩过的坑：摆放走事务引擎，只返回 `resultingRevisions` 这个映射，而复制、删除走的是
 * 另一条路，返回扁平的 `baseRevision`——同一个领域同一个概念两种形状。模型每摆一个物体都
 * 要额外读一次工程，叠加单轮工具位轮换，任务直接卡死。
 */
const cameraStageWrites = BUILTIN_APPLICATION_CAPABILITIES.filter((capability) => (
  capability.domain === 'camera_stage' && !capability.readOnly
))

function schemaKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape
    ?? (schema as { _def?: { shape?: Record<string, unknown> } } | undefined)?._def?.shape
  return shape ? Object.keys(shape) : []
}

describe('三维写入的 revision 契约', () => {
  it('存在需要检查的写能力', () => {
    expect(cameraStageWrites.length).toBeGreaterThan(4)
  })

  // 新建与打开工程不存在"读取之后被改动"的问题，天然没有基线可比。
  const revisionScoped = cameraStageWrites.filter((capability) => (
    schemaKeys(capability.inputSchema).includes('baseRevision')
  ))

  it('除新建与打开外的写能力都收 baseRevision', () => {
    const withoutBaseRevision = cameraStageWrites
      .filter((capability) => !revisionScoped.includes(capability))
      .map((capability) => capability.id)
      .sort()
    expect(withoutBaseRevision).toEqual(['create_camera_stage_project', 'open_camera_stage_project'])
  })

  it('每个写能力都回带 baseRevision，形状与读能力一致', () => {
    const missing = cameraStageWrites
      .filter((capability) => !schemaKeys(capability.outputSchema).includes('baseRevision'))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })

  it('收 baseRevision 的写能力都写明了 CONFLICT 该怎么恢复', () => {
    const missing = revisionScoped
      .filter((capability) => !capability.failureRecovery.some((item) => item.includes('CONFLICT')))
      .map((capability) => capability.id)
    expect(missing).toEqual([])
  })
})
