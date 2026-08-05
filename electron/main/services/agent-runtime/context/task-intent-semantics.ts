import type {
  AgentTaskCapabilityKind,
  AgentTaskRequiredEffect,
} from '../../../../../src/core/assistant/taskGraph'
import type { AgentIntent } from './types'

export interface IntentTaskSemantics {
  capabilityKinds: AgentTaskCapabilityKind[]
  effect: AgentTaskRequiredEffect['effect']
  entityTypes: string[]
}

export function explicitlyCreatesProject(goal: string): boolean {
  return [...goal.normalize('NFKC').matchAll(/(?:新建|创建|建立)(.{0,32}?)(?:项目|工程)/gi)]
    .some((match) => !/(?:已有|现有|当前|这个|该|节点|物体|对象|关键帧|镜头|动画)/i.test(match[1] ?? ''))
}

const deletePattern = /(?:删除|移除|清除|永久删除|忘记|拒绝|delete|remove|forget|reject)/i
const createPattern = /(?:新建|创建|建立|添加|加入|复制|连接|记住|提出|create|add|duplicate|connect|remember|propose)/i
const mutationPattern = /(?:修改|更改|更新|设置.{0,20}(?:为|成)|设为|改成|调整|重命名|选择|确认|应用|保存|change|update|set|rename|select|confirm|apply|save)/i
const togglePattern = /(?:开启|关闭|启用|禁用|enable|disable)/i
const toggleQuestionPattern = /(?:是否|有没有|当前|现在|查看|查询).{0,20}(?:开启|关闭|启用|禁用|enable|disable)|(?:开启|关闭|启用|禁用|enable|disable).{0,8}(?:吗|状态|没有)/i
const executePattern = /(?:生成|执行|运行|开始|继续|恢复|暂停|取消|停止|回滚|编辑|标注|裁剪|旋转|下载|导出|generate|execute|run|resume|pause|cancel|stop|rollback|edit|crop|rotate|download|export)/i
const navigatePattern = /(?:打开|进入|切换|定位|聚焦|展示|关闭页面|open|navigate|switch|focus)/i

function mutationEffect(goal: string): AgentTaskRequiredEffect['effect'] | null {
  if (deletePattern.test(goal)) return 'delete'
  if (createPattern.test(goal)) return 'create'
  if (mutationPattern.test(goal) || (togglePattern.test(goal) && !toggleQuestionPattern.test(goal))) return 'update'
  if (executePattern.test(goal)) return 'execute'
  if (navigatePattern.test(goal)) return 'navigate'
  return null
}

function semantics(
  effect: AgentTaskRequiredEffect['effect'],
  entityTypes: string[],
): IntentTaskSemantics {
  const capabilityKinds: AgentTaskCapabilityKind[] = effect === 'observe'
    ? ['observe', 'query']
    : effect === 'navigate'
      ? ['observe', 'navigate']
      : effect === 'execute'
        ? ['observe', 'query', 'plan', 'execute']
        : ['observe', 'query', 'plan', 'mutate']
  return { capabilityKinds, effect, entityTypes }
}

export function inferIntentTaskSemantics(intent: AgentIntent, goal: string): IntentTaskSemantics {
  const mutation = mutationEffect(goal)
  switch (intent) {
    case 'navigate': return semantics('navigate', ['application.surface'])
    case 'generate': return semantics('execute', ['generation.task'])
    case 'inspect_model': return semantics('observe', ['generation.model'])
    case 'read_generation': return semantics('observe', ['generation.task', 'generation.result'])
    case 'cancel_generation': return semantics('execute', ['generation.task'])
    case 'diagnose': return semantics('observe', ['diagnostics.event'])
    case 'camera_stage': return semantics('execute', ['camera_stage.scene'])
    case 'image_edit': return semantics('execute', ['image_edit.preview'])
    case 'settings': return semantics(
      mutation ?? 'observe',
      mutation === 'navigate' ? ['application.surface'] : ['application.setting'],
    )
    case 'user_instructions': return semantics(mutation ? 'update' : 'observe', ['assistant.user_instructions'])
    case 'memory': return semantics(mutation ?? 'observe', [
      mutation === 'create' ? 'assistant.memory_candidate' : 'assistant.memory',
    ])
    case 'canvas': {
      const targetsNode = /(?:节点|连线|node|edge)/i.test(goal)
      return semantics(mutation ?? 'observe', [targetsNode ? 'canvas.node' : 'canvas.project'])
    }
    case 'assets': return semantics(
      mutation === 'create' ? 'update' : mutation ?? 'observe',
      ['asset'],
    )
    case 'toolbox': return semantics(
      mutation === 'navigate' || mutation === 'update' ? 'navigate' : 'observe',
      mutation ? ['application.surface'] : ['toolbox.state'],
    )
    case 'workflow': return semantics(mutation ? 'execute' : 'observe', ['workflow.run'])
    case 'storyboard': return semantics(mutation ?? 'observe', ['storyboard.project'])
    case 'general': return semantics('observe', [])
  }
}
