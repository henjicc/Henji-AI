import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../../src/core/assistant/builtinApplicationCapabilityRegistry'

import {
  ASSISTANT_REGRESSION_CASES,
  DOMAIN_COVERAGE_EVALUATION_CASES,
  FINAL_ACCEPTANCE_EVALUATION_CASES,
  LOOP_TERMINATION_EVALUATION_CASES,
  SECURITY_GATE_EVALUATION_CASES,
} from './regression-cases'

describe('assistant regression datasets', () => {
  it('包含黄金、历史失败、对抗、边界和恢复数据集', () => {
    const categories = new Set(ASSISTANT_REGRESSION_CASES.map((item) => item.category))
    expect(categories).toEqual(new Set(['golden', 'historical', 'adversarial', 'boundary', 'recovery', 'security']))
    expect(ASSISTANT_REGRESSION_CASES.length).toBeGreaterThanOrEqual(28)
  })

  it('所有用例都有预算、安全约束和唯一标识', () => {
    const ids = ASSISTANT_REGRESSION_CASES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ASSISTANT_REGRESSION_CASES.every((item) => (
      item.maxLatencyMs > 0
      && item.maxInputTokens > 0
      && item.maxOutputTokens > 0
      && Array.isArray(item.forbiddenTools)
    ))).toBe(true)
  })

  it('智能性基线覆盖七类场景并记录可验证约束', () => {
    const baselineCases = ASSISTANT_REGRESSION_CASES.filter((item) => item.baselineScenario)
    expect(new Set(baselineCases.map((item) => item.baselineScenario))).toEqual(new Set([
      'generation', 'ambiguous', 'cross_workspace', 'model_preference',
      'tool_recovery', 'write_verification', 'long_context',
    ]))
    expect(baselineCases.every((item) => (
      (item.acceptableToolSequences?.length ?? 0) > 0
      && (item.successEvidence?.length ?? 0) > 0
      && (item.forbiddenBehaviors?.length ?? 0) > 0
      && (item.expectedToolDomains?.length ?? 0) > 0
      && (item.evidenceRequirements?.length ?? 0) > 0
    ))).toBe(true)
  })

  it('覆盖工具箱、3D、分镜、图片编辑、素材、工作流、指令、记忆与一般问答', () => {
    expect(new Set(DOMAIN_COVERAGE_EVALUATION_CASES.map((item) => item.expectedIntent))).toEqual(new Set([
      'toolbox', 'camera_stage', 'storyboard', 'assets', 'workflow',
      'user_instructions', 'memory', 'image_edit', 'general',
    ]))
    expect(DOMAIN_COVERAGE_EVALUATION_CASES.every((item) => (
      (item.expectedToolDomains?.length ?? 0) > 0
      && (item.evidenceRequirements?.length ?? 0) > 0
    ))).toBe(true)
  })

  it('安全门槛覆盖提示注入、未知写入重放和高风险审批', () => {
    expect(SECURITY_GATE_EVALUATION_CASES).toHaveLength(3)
    expect(SECURITY_GATE_EVALUATION_CASES.some((item) => item.sensitiveProbes?.length)).toBe(true)
    expect(SECURITY_GATE_EVALUATION_CASES.some((item) => item.forbidUnknownWriteReplay)).toBe(true)
    expect(SECURITY_GATE_EVALUATION_CASES.some((item) => item.expectedApprovalRisks?.includes('R3'))).toBe(true)
  })

  it('循环终止数据覆盖重复发现、重复写入、无效参数、缺能力、用户输入和 revision 冲突', () => {
    expect(LOOP_TERMINATION_EVALUATION_CASES).toHaveLength(6)
    expect(LOOP_TERMINATION_EVALUATION_CASES.map((item) => item.id)).toEqual([
      'loop-repeated-capability-discovery',
      'loop-repeated-object-create',
      'loop-invalid-patch-stops',
      'loop-missing-capability-partial-report',
      'loop-user-input-waiting',
      'loop-revision-conflict-refresh-first',
    ])
    expect(LOOP_TERMINATION_EVALUATION_CASES.every((item) => (
      (item.successEvidence?.length ?? 0) > 0
      && (item.forbiddenBehaviors?.length ?? 0) > 0
    ))).toBe(true)
  })

  it('最终 3D 组合验收固定发现、轮次、工具、Token 与恢复阈值', () => {
    expect(FINAL_ACCEPTANCE_EVALUATION_CASES).toHaveLength(1)
    const testCase = FINAL_ACCEPTANCE_EVALUATION_CASES[0]
    expect(testCase).toMatchObject({
      expectedIntent: 'camera_stage',
      maxTurns: 12,
      maxToolCalls: 12,
      maxInputTokens: 250_000,
      maxIdenticalToolCalls: 2,
    })
    expect(testCase.expectedTools.find((tool) => tool.toolName === 'discover_application_capabilities')?.maxCalls).toBe(1)
    expect(testCase.forbiddenTools).toEqual(expect.arrayContaining([
      'create_camera_stage_project', 'duplicate_camera_stage_object',
    ]))
    expect(testCase.successEvidence).toEqual(expect.arrayContaining([
      '复用既有工程与默认摄像机', '无冲突空间布置', '语义运镜结果',
    ]))
    for (const tool of testCase.expectedTools) {
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.toolName), tool.toolName).toBeDefined()
    }
  })
})
