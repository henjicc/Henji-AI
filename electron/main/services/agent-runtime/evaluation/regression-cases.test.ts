import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../../src/core/assistant/builtinApplicationCapabilityRegistry'

import { AGENT_TOOL_DOMAINS } from '../context/types'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { MINIMAL_ASSISTANT_EVALUATION_CASES } from './minimal-cases'
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

/**
 * 门禁：**用例点名的每个工具都必须真的存在。**
 *
 * 这批用例定义没有驱动器——上面的断言只检查列表形状（数量、id 唯一、intent 集合），从不确认
 * 它描述的东西是否属实。于是一条用例可以安安静静地要求模型调用一个**根本不存在的工具**，
 * 而所有测试全绿。实测就有一条：`coverage-workflow-catalog` 要求调用 `list_workflows`，
 * 全项目没有这个工具，同批的其余 7 个同类工具名却都存在。
 *
 * 这类用例比没有更糟：它给出"这个域已经覆盖到了"的错觉，而它守的其实是一个空洞。
 * 上面 `FINAL_ACCEPTANCE` 那条已经在做同一件事，只是当时只用在 1 条用例上、只查前端能力注册表；
 * 这里扩到全部用例，并改用**真实工具注册表**（同时含前端能力与后端内建工具）作为权威。
 */
describe('评测用例引用的工具与域必须真实存在', () => {
  /**
   * 已知未实现的工具名。与 `capability-domain-coverage.test.ts` 的 `KNOWN_EMPTY_DOMAINS`
   * 是**同一笔欠账的两处表现**：`workflows` 整个域都没有能力，`list_workflows` 是它在评测用例
   * 里留下的影子。
   *
   * 只许变短。补齐 workflows 能力或删掉该域时，这里和那边要一起销账——下面的销账断言会盯着。
   */
  const KNOWN_MISSING_TOOLS: Record<string, string> = {
    list_workflows: 'workflows 域尚未注册任何能力，见 context/capability-domain-coverage.test.ts 的 KNOWN_EMPTY_DOMAINS',
  }

  const registry = createBuiltinAgentToolRegistry(async () => {
    throw new Error('测试不执行前端工具')
  })
  const toolNames = new Set(registry.allDefinitions().map((definition) => definition.name))
  const allCases = [...ASSISTANT_REGRESSION_CASES, ...MINIMAL_ASSISTANT_EVALUATION_CASES]

  it('注册表规模足够，否则下面的遍历会假绿', () => {
    expect(toolNames.size).toBeGreaterThan(60)
    expect(allCases.length).toBeGreaterThan(30)
  })

  it('expectedTools 与 acceptableToolSequences 点名的工具都已注册', () => {
    /*
     * 这两个字段描述的是"这次运行必须真的做的事"。名字错了，用例不是变松，是变成假的——
     * 打分器永远找不到这个工具调用，`minCalls` 检查必然不通过，可这批用例从没被驱动过，
     * 所以谁都不会发现。
     */
    const unknown = (name: string): boolean => !toolNames.has(name) && !(name in KNOWN_MISSING_TOOLS)
    const missing = allCases.flatMap((testCase) => [
      ...testCase.expectedTools
        .map((tool) => tool.toolName)
        .filter(unknown)
        .map((name) => `${testCase.id}.expectedTools → ${name}`),
      ...(testCase.acceptableToolSequences ?? []).flat()
        .filter(unknown)
        .map((name) => `${testCase.id}.acceptableToolSequences → ${name}`),
      ...Object.keys(testCase.expectedCompletionKinds ?? {})
        .filter(unknown)
        .map((name) => `${testCase.id}.expectedCompletionKinds → ${name}`),
    ])

    expect(missing, [
      '以下用例要求模型调用不存在的工具——用例给出"这个域已覆盖"的错觉，守的却是空洞：',
      ...missing,
      '要么注册该工具，要么把用例改到真实工具上，要么连同该域的登记一起删掉。',
    ].join('\n')).toEqual([])
  })

  it('forbiddenTools 点名的工具都已注册', () => {
    /*
     * 禁用清单里的名字同样会漂移：工具改名后旧名字留在这里，看着像还在防着，实际谁都不禁。
     * 它不像 expectedTools 那样会让用例直接失效，但同样是一条说谎的断言。
     */
    const missing = allCases.flatMap((testCase) => (
      testCase.forbiddenTools
        .filter((name) => !toolNames.has(name))
        .map((name) => `${testCase.id}.forbiddenTools → ${name}`)
    ))

    expect(missing, [
      '以下禁用项指向不存在的工具，看着像在防着，实际什么都没禁（多半是工具改名后没同步）：',
      ...missing,
    ].join('\n')).toEqual([])
  })

  it('expectedToolDomains 点名的域都在 AGENT_TOOL_DOMAINS 里', () => {
    const declared = new Set<string>(AGENT_TOOL_DOMAINS)
    const missing = allCases.flatMap((testCase) => (
      (testCase.expectedToolDomains ?? [])
        .filter((domain) => !declared.has(domain))
        .map((domain) => `${testCase.id}.expectedToolDomains → ${domain}`)
    ))

    expect(missing, [
      '以下用例点名的域不在 AGENT_TOOL_DOMAINS 里：',
      ...missing,
    ].join('\n')).toEqual([])
  })

  it('已实现的工具必须从 KNOWN_MISSING_TOOLS 里销账', () => {
    // 欠账清单只许变短。补齐了却忘了销账，下一个人看到的就是一份说谎的清单。
    const stale = Object.keys(KNOWN_MISSING_TOOLS).filter((name) => toolNames.has(name))

    expect(stale, [
      '以下工具已经注册了，但还挂在 KNOWN_MISSING_TOOLS 里，账没销：',
      ...stale,
      '同时检查 context/capability-domain-coverage.test.ts 的 KNOWN_EMPTY_DOMAINS 是否也该销账。',
    ].join('\n')).toEqual([])
  })
})
