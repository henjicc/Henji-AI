import { describe, expect, it } from 'vitest'

import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import { contextSnapshot } from './context-test-fixtures'
import { AgentIntentRouter } from './router'
import {
  deriveThreadContinuation,
  describeContinuationForRouter,
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

  /*
   * 真实语料全量保留，但断言从「isContinuationGoal 判定正确」改成「上一轮领域可达」。
   *
   * 这三组原话覆盖了三次实测事故与两类边界：带新诉求的承接、零信息量的反馈式追问、
   * 自带完整新诉求的长句。以前它们守的是一张中文词表判得准不准；那张词表已经删除
   * （见 thread-continuation.ts 顶部说明），现在守的是用户能不能接着上一轮把事做完。
   */
  it('同线程里的任何一句话都让上一轮领域可达', async () => {
    const router = new AgentIntentRouter(async () => (
      // 分类器刻意返回实测里那些错误结论，验证并集独立生效。
      { intent: 'generate', toolDomains: ['generation'], reason: '判成生成' }
    ))
    for (const goal of [
      // 带新诉求的承接
      '再帮我添加一个白色的球体', '继续把动画补完',
      // 零信息量的反馈式追问：三次事故里最致命的一类
      '你这不对吧', '不对啊', '没成功啊', '怎么回事', '为什么没做',
      '失败了？', '重来', '你搞错了', '？？？',
      // 自带完整新诉求的长句：以前被判为「非承接」，现在同样并入——代价只是多几个候选领域
      '这个图太糊了，帮我换一个模型重新生成一张更清晰的猫的图片',
      '为什么我的素材库里有这么多重复文件，帮我整理一下素材库并删除重复项',
    ]) {
      const decision = await router.route(
        `run-corpus-${goal}`,
        goal,
        generationSnapshot(),
        new AbortController().signal,
        deriveThreadContinuation(cameraStageHistory())
      )
      expect(decision.toolDomains, goal).toContain('camera_stage')
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
      reason: '当前在生成工作区，判断为生成一张白色球体图片',
      explicitUserIntent: true,
    }))
    const decision = await router.route(
      'run-1',
      '再帮我添加一个白色的球体',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    // 断言的是**行为**（上一轮领域可达），不是某个实现细节命中了。
    // candidateIntents 已随 7 个零消费方字段一起删除；能不能做到事，只看 toolDomains。
    expect(decision.toolDomains).toContain('camera_stage')
    expect(decision.continuationDomains).toContain('camera_stage')
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
      reason: '用户在质疑上一轮结果，判断为诊断',
      explicitUserIntent: true,
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

  /*
   * 复现第三次实测失败：用户只说了「你继续」。路由模型把它判成 canvas，任务图于是只生成一个
   * canvas Facet，上一轮真正在做的 camera_stage 只能靠补位名额挤进来——补位按字母序选，恰好
   * 没选中 place_camera_stage_object，运行卡在"任务图仍有 1 个 Facet 未结算"。
   *
   * 这几句原话全部保留，但断言从「实现命中了承接分支」改成「上一轮的领域可达」。
   *
   * 旧实现靠 isPureContinuationGoal 这张中文词表（「你继续/不对/没成功/怎么回事」+ 30 字符
   * 上限）短路整条路由：跳过分类器、继承上一轮 intent、用上一轮原话建任务图。它确实多做了
   * 两件好事，但代价是一张永远补不完的词表——用户表达不满的说法是无穷的，而漏掉一句的后果
   * 就是这三次实测事故。
   *
   * 现在改成无条件并集：不判断这句话算不算承接，只要同线程有历史证据就把上一轮领域并进来。
   * 卡死运行的**核心**原因是「camera_stage 根本不在池子里」，并集直接消除它。
   *
   * 明确记录被放弃的两点：分类器不再被短路（一句零信息量的话仍会烧一次模型调用），
   * intent 也不再继承上一轮。后者在任务图删除后消费方只剩模型目录注入与评测打分，影响有限。
   */
  it('零信息量的承接语句仍让上一轮领域可达', async () => {
    const router = new AgentIntentRouter(async () => (
      { intent: 'canvas', toolDomains: ['canvas'], reason: '判断为画布任务' }
    ))
    for (const goal of ['你继续', '继续吧', '你这不对吧', '没成功啊', '怎么回事', '重来', '？？？']) {
      const decision = await router.route(
        `run-${goal}`,
        goal,
        generationSnapshot(),
        new AbortController().signal,
        deriveThreadContinuation(cameraStageHistory())
      )
      // 判据是「做得到事」，不是「分类对了」。
      expect(decision.toolDomains, goal).toContain('camera_stage')
      expect(decision.continuationDomains, goal).toContain('camera_stage')
    }
  })

  it('没有历史领域证据时不接管路由', async () => {
    let called = false
    const router = new AgentIntentRouter(async () => {
      called = true
      return { intent: 'general', reason: '无法判断' }
    })
    const decision = await router.route(
      'run-no-history',
      '你继续',
      generationSnapshot(),
      new AbortController().signal,
      null
    )
    expect(called).toBe(true)
    expect(decision.intent).toBe('general')
  })

  /*
   * 无条件并集的代价，明写出来。
   *
   * 同线程里问一件全新的事，上一轮的领域也会被并进 toolDomains。这是刻意接受的交换：
   * 判断"这句话是不是承接"只能靠读文本，而那正是被删掉的那张词表。两边代价严重不对称——
   * 多带一两个候选领域只影响能力发现的排序（准入仍由 registry.list 与审批把关），
   * 而少带一个领域会让整次运行没有出口，已实测三次。
   */
  it('新任务也会并入上一轮领域，主意图不受影响', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      toolDomains: ['generation'],
      reason: '生成一张图片',
      explicitUserIntent: true,
    }))
    const decision = await router.route(
      'run-3',
      '帮我生成一张猫的图片',
      generationSnapshot(),
      new AbortController().signal,
      deriveThreadContinuation(cameraStageHistory())
    )
    expect(decision.toolDomains).toContain('camera_stage')
    // 主意图不被延续证据改写：它牵着模型目录注入与评测打分。
    expect(decision.intent).toBe('generate')
    expect(decision.toolDomains).toContain('generation')
  })

  it('没有历史证据的线程不扩域', async () => {
    const router = new AgentIntentRouter(async () => ({
      intent: 'generate',
      toolDomains: ['generation'],
      reason: '生成一张图片',
      explicitUserIntent: true,
    }))
    const decision = await router.route(
      'run-fresh',
      '帮我生成一张猫的图片',
      generationSnapshot(),
      new AbortController().signal,
      null
    )
    expect(decision.toolDomains).not.toContain('camera_stage')
    expect(decision.continuationDomains).toBeUndefined()
  })
})


