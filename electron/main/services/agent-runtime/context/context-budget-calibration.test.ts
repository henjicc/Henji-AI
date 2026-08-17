import { describe, expect, it } from 'vitest'

import { AgentContextBuilder } from './builder'
import { contextSnapshot, skillMetadata } from './context-test-fixtures'
import type { AgentContextBuildInput } from './types'

/*
 * 分层预算必须按供应商实收量走，不能按估算器的高估值走。
 *
 * 实测三维场景第 7 轮：估 46,248、供应商实收 32,046，高估 44%。预算被这一万多虚数吃掉，
 * `user_instructions` 与 `skills_index` 被判超额丢弃——两层都在可缓存前缀里，一丢整段对话
 * 缓存作废（命中量 20,480 → 4,096），模型正在写最终答复时失去了技能索引。按实收量重算，
 * 那一轮全部层加起来根本没到阈值。
 */

/** 中文一字一 token，用它把估算值调到可预期的量级。 */
const LONG_HISTORY = '历'.repeat(44_000)

function buildInput(
  lastModelUsage?: AgentContextBuildInput['lastModelUsage']
): AgentContextBuildInput {
  return {
    runId: 'run-calibration',
    goal: '把球体移动到指定坐标',
    userInstructions: '回复保持简洁。'.repeat(40),
    skills: [skillMetadata('camera-stage', '三维镜头参考台的操作要点')],
    snapshot: contextSnapshot(),
    route: {
      intent: 'canvas', toolDomains: ['camera_stage'],
      reason: '预算校准测试', explicitUserIntent: true,
    },
    conversation: [{ role: 'assistant', content: LONG_HISTORY }],
    observations: [],
    modelTools: [],
    activeToolNames: [],
    contextWindowBudget: 64_000,
    lastModelUsage,
  }
}

/*
 * 两个用例只差 `estimatedInputTokens` 一个字段，因为缺陷本身就长这样：
 * 压缩判定拿到了供应商实收量（28,600，不压缩），分层预算却仍按估算器的高估值减阈值，
 * 于是「不用压缩」和「一层都放不下」这两个结论在同一次构建里同时成立。
 */
describe('分层预算按供应商实收量校准', () => {
  it('只有实收量、没有同轮估算值时，预算仍被估算器的高估挤干', () => {
    const result = new AgentContextBuilder().build(buildInput({
      inputTokens: 28_600,
      conversationMessageCount: 1,
    }))

    // 实收量说远没到阈值，所以不压缩；预算却按高估值算，可缓存前缀里的层首当其冲。
    expect(result.compacted).toBe(false)
    expect(result.droppedLayers).toContain('skills_index')
    expect(result.droppedLayers).toContain('user_instructions')
  })

  it('补上同轮估算值后倍率成立，前缀层不再被误判超额', () => {
    const result = new AgentContextBuilder().build(buildInput({
      // 上一轮估 44,000、实收 28,600，倍率 0.65——正是三维场景实测到的量级。
      inputTokens: 28_600,
      estimatedInputTokens: 44_000,
      conversationMessageCount: 1,
    }))

    expect(result.compacted).toBe(false)
    expect(result.droppedLayers).not.toContain('skills_index')
    expect(result.droppedLayers).not.toContain('user_instructions')
  })

  it('倍率下限夹在 0.5：离谱的实收量只能等价于 0.5，不会按 0.018 放大 55 倍', () => {
    const absurd = new AgentContextBuilder().build(buildInput({
      inputTokens: 800, estimatedInputTokens: 44_000, conversationMessageCount: 1,
    }))
    const clampBoundary = new AgentContextBuilder().build(buildInput({
      inputTokens: 22_000, estimatedInputTokens: 44_000, conversationMessageCount: 1,
    }))

    expect(absurd.estimatedTokens).toBe(clampBoundary.estimatedTokens)
    expect(absurd.droppedLayers).toEqual(clampBoundary.droppedLayers)
  })
})
