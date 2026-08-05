import { describe, expect, it } from 'vitest'

import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import { contextSnapshot } from './context-test-fixtures'
import { AgentIntentRouter } from './router'
import {
  deriveThreadContinuation,
  describeContinuationForRouter,
  isContinuationGoal,
} from './thread-continuation'

/*
 * 复现实测失败：上一轮刚在三维工程「测试332333」里摆完物体，用户接着说
 * 「再帮我添加一个白色的球体」。
 *
 * 路由模型只拿得到这一句话和"当前在生成工作区"，判成 generate；camera_stage 因此不在
 * toolDomains 里，能力发现怎么问都只返回 generation 能力。主模型两次判断正确，最后反被
 * 工具目录说服，去生成了一张球体图片。
 */

function cameraStageHistory(): ModelStepMessage[] {
  return [
    { role: 'user', content: '在三维镜头里新建工程，放一个紫色立方体和红色圆柱' },
    {
      role: 'assistant',
      content: '已创建 camera_stage.project「测试332333」，并放置 camera_stage.object 两个。',
    },
    {
      role: 'tool',
      content: [{
        type: 'text',
        text: JSON.stringify({
          surfaceId: 'tool.camera_stage',
          entityType: 'camera_stage.object',
          objectId: 'obj-cube-1',
        }),
      }],
    },
  ]
}

function generationSnapshot(): ReturnType<typeof contextSnapshot> {
  // 重启之后回到默认的生成工作区——正是实测时的状态。
  return {
    ...contextSnapshot(),
    surface: { id: 'workspace.generation', kind: 'workspace' },
  } as ReturnType<typeof contextSnapshot>
}

describe('会话延续证据', () => {
  it('从历史里认出上一轮的领域和页面', () => {
    const continuation = deriveThreadContinuation(cameraStageHistory())
    expect(continuation).not.toBeNull()
    expect(continuation?.domains).toContain('camera_stage')
    expect(continuation?.surfaceIds).toContain('tool.camera_stage')
    expect(continuation?.previousUserGoals[0]).toContain('三维镜头')
  })

  it('延续词判定不把全新任务卷进来', () => {
    expect(isContinuationGoal('再帮我添加一个白色的球体')).toBe(true)
    expect(isContinuationGoal('继续把动画补完')).toBe(true)
    expect(isContinuationGoal('帮我生成一张猫的图片')).toBe(false)
    expect(isContinuationGoal('打开素材库')).toBe(false)
  })

  /*
   * 复现第二次实测失败：用户取消了那次跑偏的生成之后，只说了一句「你这不对吧」。
   *
   * 这句话命不中任何延续词，延续加宽整个被跳过；路由判成 diagnose，任务图只生成一个 diagnose
   * Facet，能力发现返回 0 项能力 0 个租约，助手最后只能停下来解释自己被阻塞。可这句话里
   * **没有任何新任务信息**——它唯一可能指向的就是上一轮。
   */
  it('不带延续词的反馈式追问同样算承接', () => {
    for (const goal of [
      '你这不对吧', '不对啊', '没成功啊', '怎么回事', '为什么没做',
      '失败了？', '重来', '你搞错了', '？？？',
    ]) {
      expect(isContinuationGoal(goal), goal).toBe(true)
    }
  })

  it('自带完整新诉求的长句不靠承接兜底', () => {
    // 这类句子路由本来就能判对，不需要把上一轮的域拖进来。
    for (const goal of [
      '这个图太糊了，帮我换一个模型重新生成一张更清晰的猫的图片',
      '为什么我的素材库里有这么多重复文件，帮我整理一下素材库并删除重复项',
    ]) {
      expect(isContinuationGoal(goal), goal).toBe(false)
    }
  })

  it('给路由模型的历史行包含上一轮领域', () => {
    const line = describeContinuationForRouter(deriveThreadContinuation(cameraStageHistory()))
    expect(line).toContain('camera_stage')
    expect(line).toContain('tool.camera_stage')
  })

  it('无历史时不产生任何延续证据', () => {
    expect(deriveThreadContinuation(undefined)).toBeNull()
    expect(deriveThreadContinuation([])).toBeNull()
    expect(describeContinuationForRouter(null)).toBeNull()
  })
})

describe('路由承接上一轮任务', () => {
  it('分类模型判成 generate 时，仍把 camera_stage 并进工具域', async () => {
    // 分类器刻意返回实测里那个错误结论，验证放宽逻辑独立生效。
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      candidateIntents: ['generate'],
      toolDomains: ['generation', 'models'],
      complexity: 'simple',
      reason: '当前在生成工作区，判断为生成一张白色球体图片',
    }))
    const decision = await router.route(
      'run-1',
      '再帮我添加一个白色的球体',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    expect(decision.toolDomains).toContain('camera_stage')
    expect(decision.continuationDomains).toContain('camera_stage')
    expect(decision.candidateIntents).toContain('camera_stage')
    // 主意图不被改写：路由的 intent 还牵着模型目录注入等一串下游行为。
    expect(decision.intent).toBe('generate')
  })

  it('分类器把延续证据当输入收到', async () => {
    let received: string | null | undefined
    const router = new AgentIntentRouter(async (_goal, _snapshot, _signal, continuation) => {
      received = continuation
      return { intent: 'generate', reason: '测试' }
    })
    await router.route(
      'run-2',
      '再帮我添加一个白色的球体',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    expect(received).toContain('camera_stage')
  })

  it('用户说「你这不对吧」时也把上一轮的域并进来', async () => {
    // 分类器返回实测里那个结论：intent=diagnose，域里已经有 camera_stage（模型读了历史行）。
    const router = new AgentIntentRouter(async () => ({
      intent: 'diagnose',
      toolDomains: ['diagnostics'],
      complexity: 'ambiguous',
      reason: '用户在质疑上一轮结果，判断为诊断',
    }))
    const decision = await router.route(
      'run-not-right',
      '你这不对吧',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    expect(decision.toolDomains).toContain('camera_stage')
    expect(decision.continuationDomains).toContain('camera_stage')
  })

  it('不是延续语句时保持原样，不平白扩域', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      toolDomains: ['generation'],
      reason: '生成一张图片',
    }))
    const decision = await router.route(
      'run-3',
      '帮我生成一张猫的图片',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    expect(decision.toolDomains).not.toContain('camera_stage')
    expect(decision.continuationDomains).toBeUndefined()
  })
})
