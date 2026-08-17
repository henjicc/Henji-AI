// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import recordedCanvasRun from './fixtures/9bae0c64.recorded.json'
import recordedGenerationRun from './fixtures/9bb30dff.recorded.json'
import {
  loadRecordedScript,
  REPLAY_NONCE,
  runAssistantHarness,
  type RecordedAssistantScript,
} from './assistantRuntimeHarness'

/**
 * 录制回放：**用真模型当时写出来的那份脚本，在零成本环境里重跑一遍。**
 *
 * 手写正路剧本等于我替模型想它会怎么做，写着写着就漂移到不现实；录制下来的才是模型
 * 在真机上实际写的东西。契约变更时手写要逐条改，录制只需重录一次。
 *
 * 录制来源是 `agent_model_traces`，不是 `agent_events`——后者的 ToolRequested 只存
 * inputDigest，没有入参。生成命令见 `npm run assistant:record -- --list`。
 */
describe('真机录制的剧本回放', () => {
  beforeAll(async () => { await loadRealModelsIntoRegistry() })

  beforeEach(() => {
    useProjectStore.setState({
      projects: [], currentProjectId: null, currentProject: null, isHydrated: true,
    })
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  it('画布场景：回放真模型写的脚本，正式画布状态与真机跑一致', async () => {
    const recorded = recordedCanvasRun as RecordedAssistantScript
    const { goal, steps } = loadRecordedScript(recorded)

    // 防空转：录制文件被清空或换成别的运行时，下面的断言会变得没有意义。
    expect(recorded.recordedFrom.status, '只回放当时真的跑通了的运行').toBe('completed')
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(
      JSON.stringify(steps),
      '占位符必须在回放前全部替换掉，否则脚本会拿 {{nonce}} 当真名去创建工程。',
    ).not.toContain('{{nonce}}')

    const result = await runAssistantHarness({ goal, intent: 'canvas', steps })

    expect(
      result.state.status,
      `终态 ${result.state.status}；${JSON.stringify(result.toolCalls)}`,
    ).toBe('completed')
    expect(result.toolCalls.filter((call) => !call.ok)).toEqual([])

    /*
     * 工具序列对账：回放必须走出与真机同一条路。
     * 只比工具名，不比 toolCallId——后者每次运行都不同，是合法差异。
     */
    const recordedToolNames = recorded.steps
      .flatMap((step) => step.actions)
      .flatMap((action) => (action.type === 'tool_call' ? [action.toolCall.toolName] : []))
    const replayedToolNames = result.toolCalls.map((call) => call.toolName)
    expect(replayedToolNames).toEqual(recordedToolNames)

    // 真相源对账：真机当时建出来的东西，回放也要建出来。
    const project = useProjectStore.getState().currentProject
    expect(project?.name).toBe(`自动验收-${REPLAY_NONCE}-画布`)
    expect(project?.nodes.length).toBe(2)
    expect(project?.edges.length).toBe(1)
    expect(
      project?.nodes.find((node) => node.type === 'stringSourceNode')?.position,
    ).toEqual({ x: 420, y: 280 })
  })

  it('录制里焊着运行时产物 id 时，加载器直接拒绝而不是悄悄回放', () => {
    /*
     * 这条守录制器最危险的失败模式：**静默产出一份失真的剧本**。
     *
     * 生成场景的续跑步骤里，模型把上一步真实产生的 task id 写死进了脚本
     * （`get_generation_task({ taskId: 'task-...' })`）。那个 id 只在录制当天的那次运行里
     * 存在，换个环境回放会指向不存在的任务，而失败会以某个领域错误的形式冒出来，
     * 没人会想到是录制的问题。所以宁可当场拒绝，也不要一份看起来能跑的假剧本。
     */
    const recorded = recordedGenerationRun as RecordedAssistantScript
    expect(
      recorded.warnings.length,
      '这份录制应当带有产物 id 告警；告警消失说明录制器的检测退化了。',
    ).toBeGreaterThan(0)
    expect(recorded.warnings.join('\n')).toMatch(/task-[a-z0-9]+/)

    expect(() => loadRecordedScript(recorded)).toThrowError(/未处理的告警/)
  })
})
