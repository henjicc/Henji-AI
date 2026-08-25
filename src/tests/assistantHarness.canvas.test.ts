// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import { runAssistantHarness } from './assistantRuntimeHarness'
import {
  installHarnessNativeStorage,
  resetHarnessNativeStorage,
  uninstallHarnessNativeStorage,
} from './harnessNativeStorage'

/**
 * 画布批量写入的**结果级**回归：一次脚本里连着写多次，值真的落进了真相源。
 *
 * 这条替代 `runner-canvas.test.ts` 守的命题（同一模型步骤里连续写工具继承前一结果 revision），
 * 但走的是真链路：真能力目录 → 真 Gateway → 真 Recipe 展开 → 真 Henji Script 解释器 →
 * 渲染层真执行器 → zustand 真相源。那份手搓测试注册的是**假画布工具**，revision 也是自己
 * 加一的，所以它只能断言"工具按顺序被调用了"，断言不了"节点真的建出来了"。
 *
 * Recipe `canvas.image_pipeline` 展开成 8 条指令、其中 4 次写入，且后面的写入要用到前面
 * 返回的 projectId / nodeId。revision 继承一旦断掉，第二次写入就会拿着过期基线撞 CONFLICT，
 * 这里直接红。
 */
describe('画布批量写入的结果级回归', () => {
  beforeAll(async () => {
    installHarnessNativeStorage()
    await loadRealModelsIntoRegistry()
  })

  afterAll(() => { uninstallHarnessNativeStorage() })

  beforeEach(() => {
    // 真相源与进程边界存储都清干净，显式工程操作仍要等待一次真实的持久化结果。
    resetHarnessNativeStorage()
    useProjectStore.setState({
      projects: [], currentProjectId: null, currentProject: null, isHydrated: true,
    })
    useCanvasStore.getState().setCanvasData([], [], { past: [], future: [] })
  })

  it('一次脚本创建工程、两个节点与连线，正式画布状态逐项对得上', async () => {
    const projectName = 'harness-画布回归'
    const result = await runAssistantHarness({
      goal: `新建名为“${projectName}”的画布工程，创建文本提示词节点和图片节点，把文本节点放在 x=420、y=280 并连接到图片节点。`,
      intent: 'canvas',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-discover',
              toolName: 'discover_application_capabilities',
              input: {
                queries: ['新建画布工程', '创建文本提示词节点与图片节点', '连接两个节点'],
                domains: ['canvas'],
                entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'],
                writes: true,
              },
              dynamic: false,
            },
          }],
        },
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-script',
              toolName: 'run_henji_script',
              input: {
                language: 'henji-ts/v1',
                summary: '创建工程、两个节点并连接',
                source: [
                  "const result = await app.recipe('canvas.image_pipeline', {",
                  `  projectName: '${projectName}',`,
                  "  prompt: '测试提示词',",
                  "  promptNodeName: '文本提示词',",
                  "  generationNodeName: '图片',",
                  '  promptPosition: { x: 420, y: 280 }',
                  '});',
                  'app.assert.exists(result.resultRefs);',
                ].join('\n'),
              },
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '画布已按要求创建完成。' }] },
      ],
    })

    expect(
      result.state.status,
      `终态 ${result.state.status}；错误 ${JSON.stringify(result.state.error)}；`
      + `工具调用 ${JSON.stringify(result.toolCalls)}`,
    ).toBe('completed')

    const failures = result.toolCalls.filter((call) => !call.ok)
    expect(failures, `不应有工具失败：${JSON.stringify(failures)}`).toEqual([])

    // ── 真相源断言：不看 completed，不看 evidence，直接读 store ──
    const project = useProjectStore.getState().currentProject
    expect(project?.name).toBe(projectName)
    expect(project?.nodes.length, `节点：${JSON.stringify(project?.nodes.map((n) => n.type))}`).toBe(2)
    expect(project?.edges.length).toBe(1)

    const promptNode = project?.nodes.find((node) => node.type === 'stringSourceNode')
    const imageNode = project?.nodes.find((node) => node.type === 'imageNode')
    expect(promptNode, '文本提示词节点应存在').toBeDefined()
    expect(imageNode, '图片节点应存在').toBeDefined()
    // 坐标是脚本里写死的绝对位置，落错说明 placement 没被真执行器消费。
    expect(promptNode?.position).toEqual({ x: 420, y: 280 })

    const edge = project?.edges[0]
    expect(edge?.source).toBe(promptNode?.id)
    expect(edge?.target).toBe(imageNode?.id)

    /*
     * harness 自身的保真度锚点，不是画布行为断言。
     *
     * `scopeRevisions` 由 `retainHostContextTracking()` 订阅各 store 后推进；harness 一旦忘了
     * retain（最初的版本就是这样），这些数会永远停在 0。那种状态下期望值与实际值恒等，
     * **任何乐观并发缺陷都撞不出来**，而整层照样全绿——实测撤掉脚本解释器的
     * `absorbScopeRevisions` 时它一声不吭。这条断言让那种失明变成一次明确的红。
     */
    expect(
      result.finalHostContext.scopeRevisions.canvas,
      'canvas revision 没有推进：harness 的 revision 订阅没接上，这一层此刻对乐观并发是瞎的。',
    ).toBeGreaterThan(0)
  })

  it('脚本里连着两次写入之间没有丢 revision 基线', async () => {
    /*
     * 这条是 runner-canvas.test.ts 的原命题，用真链路重述。
     *
     * Recipe 展开后 `add_canvas_node` 连着执行两次，第二次的 placement 还引用第一次返回的
     * nodeId。Gateway 每步都按 requiredScopes 复核 revision，而每次写入都会 bump canvas
     * scope——基线不继承的话第二次必然 CONFLICT。所以"两个节点都建出来了"就是继承成立的证据。
     */
    const result = await runAssistantHarness({
      goal: '在画布里连续写两次。',
      intent: 'canvas',
      steps: [
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-discover',
              toolName: 'discover_application_capabilities',
              input: {
                queries: ['画布连续写入'], domains: ['canvas'],
                entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'], writes: true,
              },
              dynamic: false,
            },
          }],
        },
        {
          actions: [{
            type: 'tool_call',
            toolCall: {
              toolCallId: 'call-script',
              toolName: 'run_henji_script',
              input: {
                language: 'henji-ts/v1',
                summary: '连续写入',
                source: [
                  "const result = await app.recipe('canvas.image_pipeline', {",
                  "  projectName: 'harness-连续写入',",
                  "  prompt: 'p',",
                  '});',
                  'app.assert.exists(result.resultRefs);',
                ].join('\n'),
              },
              dynamic: false,
            },
          }],
        },
        { actions: [{ type: 'text', value: '完成。' }] },
      ],
    })

    const conflicts = result.toolCalls.filter((call) => call.errorCode === 'CONFLICT')
    expect(conflicts, `出现 revision 冲突：${JSON.stringify(conflicts)}`).toEqual([])
    expect(result.state.status, JSON.stringify(result.state.error)).toBe('completed')
    expect(useProjectStore.getState().currentProject?.nodes.length).toBe(2)
  })
})
