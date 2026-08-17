import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import { AGENT_TOOL_DOMAINS, type AgentIntent, type AgentToolDomain } from './types'

/*
 * 路由层与执行层看到的世界必须是同一个。
 *
 * 主模型拿完整会话历史，路由模型只拿一句 goal 加一份被裁过的宿主快照——这个落差直接造成过
 * 一次可复现的失败：上一轮刚在三维工程「测试332333」里摆完物体，用户接着说「再帮我添加一个
 * 白色的球体」，路由模型看不到任何历史，只看到"当前在生成工作区"，判成 generate；camera_stage
 * 因此不在 toolDomains 里，能力发现怎么问都只返回 generation 能力。主模型两次判断正确，最后
 * 反被工具目录说服，去生成了一张球体图片。
 *
 * 这个模块从已经传进 Runner 的会话历史里提取最小延续证据，供两处使用：
 * 1. 确定性规则——不依赖模型，命中延续词就把上一轮领域并入本轮；
 * 2. 路由模型的输入——给它一行历史，让它自己就能判对。
 */

/** 上一轮任务的领域证据；只用于**放宽**本轮可发现范围，不授予任何权限。 */
export interface AgentThreadContinuation {
  /** 历史里的用户诉求，新→旧，最多两条。 */
  previousUserGoals: string[]
  /** 从历史证据里识别出的工具域。 */
  domains: AgentToolDomain[]
  /** 历史里出现过的 surface id，用于让路由知道上一轮真正在哪个页面干活。 */
  surfaceIds: string[]
}

const HISTORY_SCAN_LIMIT = 40
const GOAL_TEXT_LIMIT = 160

/**
 * 实体前缀 / surface id → 工具域。
 *
 * 用实体类型和 surface id 而不是工具名：前者稳定且一定会出现在工具结果里，后者随能力增删漂移。
 */
const DOMAIN_TOKENS: ReadonlyArray<readonly [string, AgentToolDomain]> = [
  ['camera_stage.', 'camera_stage'],
  ['tool.camera_stage', 'camera_stage'],
  ['storyboard.', 'storyboard'],
  ['image_edit.', 'image_edit'],
  ['tool.image_edit', 'image_edit'],
  ['canvas.', 'canvas'],
  ['workspace.canvas', 'canvas'],
  ['asset.library', 'assets'],
  ['workspace.assets', 'assets'],
  ['overlay.assets', 'assets'],
  ['generation.task', 'generation'],
  ['generation.result', 'generation'],
  ['generation.record', 'generation'],
  ['workspace.generation', 'generation'],
  ['settings.entry', 'settings'],
  ['toolbox.tool', 'toolbox'],
  ['workspace.tools', 'toolbox'],
]

const SURFACE_PATTERN = /\b(?:workspace|tool|overlay|settings)\.[a-z][a-z0-9_]*/g

/** 领域 → 该领域最贴切的意图，用于把延续证据表达成 candidateIntents。 */
const INTENT_BY_DOMAIN: Readonly<Partial<Record<AgentToolDomain, AgentIntent>>> = {
  camera_stage: 'camera_stage',
  canvas: 'canvas',
  storyboard: 'storyboard',
  image_edit: 'image_edit',
  assets: 'assets',
  generation: 'generate',
  settings: 'settings',
  toolbox: 'toolbox',
  models: 'inspect_model',
}

/*
 * 这里曾经有四条中文正则来判断「这句话算不算承接上一轮」：句首的 CONTINUATION_PATTERN
 * （再/还/继续/接着/顺便）、一张 REACTION_PATTERN 不满词表（不对/没成功/怎么回事/重来）、
 * 30 字符的 REACTION_LENGTH_LIMIT，以及整句匹配的 BARE_CONTINUATION_PATTERN。
 *
 * 方向从一开始就是错的。用户表达不满时的原话最短、最没有信息量、最不可能被词表穷尽，
 * 而那恰恰是最需要承接上一轮的时候——漏掉一句的后果就是三次实测事故：「再帮我添加一个
 * 白色的球体」判成 generate、「你这不对吧」判成 diagnose、「你继续」判成 canvas，
 * 上一轮三次都在 camera_stage，主模型三次都读懂了用户，却没有入口纠正那个判决。
 *
 * 现在不再判断：只要同线程有历史证据，router 就无条件把上一轮领域并进 toolDomains
 * （见 router.ts 的 widenWithContinuation）。本文件只保留纯抽取——从历史里读出领域与
 * Surface 证据，不做任何文本判断。
 */

function messageText(message: ModelStepMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
      ? part.text
      : ''))
    .filter(Boolean)
    .join('\n')
}

const KNOWN_DOMAINS = new Set<string>(AGENT_TOOL_DOMAINS)

export function deriveThreadContinuation(
  history: ModelStepMessage[] | undefined
): AgentThreadContinuation | null {
  if (!history || history.length === 0) return null
  const recent = history.slice(-HISTORY_SCAN_LIMIT)
  const previousUserGoals: string[] = []
  const domains = new Set<AgentToolDomain>()
  const surfaceIds = new Set<string>()

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index] as ModelStepMessage
    const text = messageText(message)
    if (!text) continue
    if (message.role === 'user' && previousUserGoals.length < 2) {
      const normalized = text.trim().replace(/\s+/g, ' ').slice(0, GOAL_TEXT_LIMIT)
      if (normalized) previousUserGoals.push(normalized)
    }
    if (message.role === 'system') continue
    for (const [token, domain] of DOMAIN_TOKENS) {
      if (text.includes(token)) domains.add(domain)
    }
    for (const surfaceId of text.match(SURFACE_PATTERN) ?? []) surfaceIds.add(surfaceId)
  }
  if (previousUserGoals.length === 0 && domains.size === 0) return null
  return {
    previousUserGoals,
    domains: [...domains],
    surfaceIds: [...surfaceIds].slice(0, 6),
  }
}

export function continuationIntents(continuation: AgentThreadContinuation): AgentIntent[] {
  return [...new Set(continuation.domains.flatMap((domain) => {
    const intent = INTENT_BY_DOMAIN[domain]
    return intent ? [intent] : []
  }))]
}

export function continuationDomains(continuation: AgentThreadContinuation): AgentToolDomain[] {
  return continuation.domains.filter((domain) => KNOWN_DOMAINS.has(domain))
}

/**
 * 给路由模型的一行历史。
 *
 * 刻意只给"上一轮问了什么 + 上一轮在哪些领域/页面留下了痕迹"，不给完整历史：路由只做意图分类，
 * 塞进整段对话既浪费 token 又会让它去执行而不是分类。
 */
export function describeContinuationForRouter(
  continuation: AgentThreadContinuation | null
): string | null {
  if (!continuation) return null
  const parts: string[] = []
  if (continuation.previousUserGoals.length > 0) {
    parts.push(`历史用户诉求（新→旧）：${continuation.previousUserGoals.join(' ｜ ')}`)
  }
  if (continuation.domains.length > 0) {
    parts.push(`上一轮已操作的领域：${continuation.domains.join('、')}`)
  }
  if (continuation.surfaceIds.length > 0) {
    parts.push(`上一轮涉及的页面：${continuation.surfaceIds.join('、')}`)
  }
  if (parts.length === 0) return null
  return [
    '同一会话的延续证据（用户可能在承接上一轮任务，而不是在当前页面开新任务）：',
    ...parts,
  ].join('\n')
}
