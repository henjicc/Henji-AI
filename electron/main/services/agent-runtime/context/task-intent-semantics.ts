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

const NEGATED_ACTION_PREFIX = /(?:不要|别|不准|禁止|不得|无需|不用|不需要|避免|切勿|不可|绝不|不能|勿|do\s+not|don't|never|without|avoid|must\s+not|no\s+need\s+to)\s*(?:再|再次|重新|继续|去|进行|执行|把|将|to)?\s*$/i
const NEGATION_SCOPE = /(?:不要|别|不准|禁止|不得|无需|不用|不需要|避免|切勿|不可|绝不|不能|勿|do\s+not|don't|never|without|avoid|must\s+not|no\s+need\s+to)/gi
const NEGATION_SCOPE_RESET = /(?:但(?:是)?|不过|而是|然后|随后|接着|之后|再(?:去|来|执行|进行)?|but|however|instead|then)/gi

function lastMatchEnd(value: string, pattern: RegExp): number {
  let end = -1
  for (const match of value.matchAll(pattern)) end = (match.index ?? 0) + match[0].length
  return end
}

function isInsideNegatedActionScope(prefix: string): boolean {
  if (NEGATED_ACTION_PREFIX.test(prefix.slice(-40))) return true
  // 协调否定必须覆盖“不要切换或打开”“do not open or navigate”中的第二个及后续动作。
  // 标点已在调用方切成分句；转折/时序词会显式结束否定作用域。
  return lastMatchEnd(prefix, NEGATION_SCOPE) > lastMatchEnd(prefix, NEGATION_SCOPE_RESET)
}

/**
 * 判断动作词是否真的被用户要求执行，而不是出现在“不要删除”“without creating”一类约束中。
 * 只看动作前同一分句的短窗口，避免一个分句里的否定错误吞掉后续明确动作；同时允许一句话中
 * 既有被否定动作又有肯定动作，肯定命中仍然成立。
 */
export function hasAffirmativeIntent(goal: string, pattern: RegExp): boolean {
  const normalized = goal.normalize('NFKC')
  const flags = [...new Set(`${pattern.flags.replace('y', '')}g`)].join('')
  // 动作与宾语也必须位于同一分句；否则“重命名图片，……不要删除素材”这类文本可能从前一个
  // “图片”一路跨标点匹配到后一个“删除”，绕过删除词前的否定判断。
  for (const clause of normalized.split(/[，。；;,.!?！？\n]/)) {
    const matcher = new RegExp(pattern.source, flags)
    for (const match of clause.matchAll(matcher)) {
      const start = match.index ?? 0
      const clausePrefix = clause.slice(0, start)
      if (!isInsideNegatedActionScope(clausePrefix)) return true
    }
  }
  return false
}

/** 与 hasAffirmativeIntent 对称，供任务图保存用户明确声明的负向执行约束。 */
export function hasNegatedIntent(goal: string, pattern: RegExp): boolean {
  const normalized = goal.normalize('NFKC')
  const flags = [...new Set(`${pattern.flags.replace('y', '')}g`)].join('')
  for (const clause of normalized.split(/[，。；;,.!?！？\n]/)) {
    const matcher = new RegExp(pattern.source, flags)
    for (const match of clause.matchAll(matcher)) {
      const prefix = clause.slice(0, match.index ?? 0)
      if (isInsideNegatedActionScope(prefix)) return true
    }
  }
  return false
}

export function explicitlyCreatesProject(goal: string): boolean {
  const normalized = goal.normalize('NFKC')
  return [...normalized.matchAll(/(?:新建|创建|建立).{0,48}?(?:项目|工程)/gi)]
    .some((match) => {
      const clauseStart = match.index ?? 0
      const prefix = normalized.slice(0, clauseStart).split(/[，。；;,.!?！？\n]/).at(-1) ?? ''
      if (NEGATED_ACTION_PREFIX.test(prefix.slice(-40))) return false
      const clause = normalized.slice(clauseStart, clauseStart + match[0].length + 24)
      // “创建当前项目中的节点”创建的是节点；“创建名为动画演示的三维工程”创建的仍是工程。
      // 目标名和描述中出现“动画/镜头/物体”不能反向否定工程创建意图。
      return !/(?:创建|新建|建立)(?:当前|现有|这个|该)?(?:项目|工程)(?:中|里|内|下|的).{0,12}(?:节点|物体|对象|关键帧|镜头|动画)/i.test(clause)
    })
}

const deletePattern = /(?:删除|移除|清除|永久删除|忘记|拒绝|delete|remove|forget|reject)/i
const createPattern = /(?:新建|创建|建立|添加|加入|复制|连接|记住|提出|create|add|duplicate|connect|remember|propose)/i
const mutationPattern = /(?:修改|更改|更新|设置.{0,20}(?:为|成)|设为|改成|调整|重命名|选择|确认|应用|保存|change|update|set|rename|select|confirm|apply|save)/i
const togglePattern = /(?:开启|关闭|启用|禁用|enable|disable)/i
const toggleQuestionPattern = /(?:是否|有没有|当前|现在|查看|查询).{0,20}(?:开启|关闭|启用|禁用|enable|disable)|(?:开启|关闭|启用|禁用|enable|disable).{0,8}(?:吗|状态|没有)/i
const executePattern = /(?:生成|执行|运行|开始|继续|恢复|暂停|取消|停止|回滚|编辑|标注|裁剪|旋转|下载|导出|generate|execute|run|resume|pause|cancel|stop|rollback|edit|crop|rotate|download|export)/i
const navigatePattern = /(?:打开|进入|切换|定位|聚焦|展示|关闭页面|open|navigate|switch|focus)/i

function mutationEffect(goal: string): AgentTaskRequiredEffect['effect'] | null {
  if (hasAffirmativeIntent(goal, deletePattern)) return 'delete'
  if (hasAffirmativeIntent(goal, createPattern)) return 'create'
  if (hasAffirmativeIntent(goal, mutationPattern)
    || (hasAffirmativeIntent(goal, togglePattern) && !toggleQuestionPattern.test(goal))) return 'update'
  if (hasAffirmativeIntent(goal, executePattern)) return 'execute'
  if (hasAffirmativeIntent(goal, navigatePattern)) return 'navigate'
  return null
}

export function asksToGenerateMedia(goal: string): boolean {
  // “已有生成结果作为图片节点”里的「生成」是结果类型，不是生成动作。中文动作不得紧跟
  // 结果/记录/历史/任务/的；英文使用词边界，避免把 generated / generation 当成 generate。
  // 否则路由会凭空创建一个必须执行的新生成 Facet，与“不要重新生成”形成永不收敛的任务图。
  const generationAction = /(?:生成(?!结果|记录|历史|任务|的)|制作|创作|绘制|画(?!布|面)|\bcreate\b|\bgenerate\b)/i
  const explicitMedia = /(?:图片|图像|照片|海报|插画|壁纸|封面|头像|视频|音频|音乐|语音|image|poster|illustration|wallpaper|cover|avatar|video|audio)/i
  // “生成一张赛博朋克海报”并不一定再写“图片”二字，但“张”已经是明确的图像量词。
  // 量词与动作必须留在同一分句，并继续经过否定极性判断，不能把“不要生成一张图”算成任务。
  const implicitImageClassifier = /(?:生成(?!结果|记录|历史|任务|的)|制作|创作|绘制|画(?!布|面)|\bcreate\b|\bgenerate\b)\s*(?:一|1|两|2|三|3|几)?\s*(?:张|幅)\s*[^，。；;,.!?！？\n]{0,48}/i
  return goal.normalize('NFKC').split(/[，。；;,.!?！？\n]/).some((clause) => (
    hasAffirmativeIntent(clause, generationAction)
    && (explicitMedia.test(clause) || hasAffirmativeIntent(clause, implicitImageClassifier))
  ))
    && !/(?:取消|停止|终止|cancel|stop).{0,24}(?:生成|任务|task)/i.test(goal)
    && !/^(?:查看|查询|检查|确认).{0,24}(?:生成历史|历史记录|状态|进度)/i.test(goal.trim())
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
    case 'settings': {
      /*
       * 设置域没有“执行型”世界变化：生成、运行、恢复等自然语言一旦落到设置语境，
       * 本质都是把设置值更新掉。例如“临时切换主题后恢复原值”中的“恢复”过去命中
       * executePattern，任务图便要求 execute effect，而正式反射只会产生 update，导致
       * 两次正确写入都先被 ACTION_EFFECT_MISMATCH 拒绝。这里按领域语义收敛，而不是继续
       * 给每种说法追加正则特判。
       */
      const settingsEffect = mutation === null
        ? 'observe'
        : mutation === 'navigate' ? 'navigate' : 'update'
      return semantics(
        settingsEffect,
        settingsEffect === 'navigate'
          ? ['application.surface']
          : settingsEffect === 'observe' ? ['application.setting'] : ['settings.registry'],
      )
    }
    case 'user_instructions': return semantics(mutation ? 'update' : 'observe', ['assistant.user_instructions'])
    case 'memory': return semantics(mutation ?? 'observe', [
      mutation === 'create' ? 'assistant.memory_candidate' : 'assistant.memory',
    ])
    case 'canvas': {
      const targetsNode = /(?:节点|连线|node|edge)/i.test(goal)
      return semantics(mutation ?? 'observe', [targetsNode ? 'canvas.node' : 'canvas.project'])
    }
    case 'assets': {
      const targetsLibrary = /(?:素材库|素材集|素材集合|集合|asset\s*(?:library|collection)|library|collection)/i.test(goal)
      return semantics(
        targetsLibrary ? mutation ?? 'observe' : mutation === 'create' ? 'update' : mutation ?? 'observe',
        [targetsLibrary ? 'asset.library' : 'asset'],
      )
    }
    case 'toolbox': return semantics(
      mutation === 'navigate' || mutation === 'update' ? 'navigate' : 'observe',
      mutation ? ['application.surface'] : ['toolbox.state'],
    )
    case 'workflow': return semantics(mutation ? 'execute' : 'observe', ['workflow.run'])
    case 'storyboard': return semantics(mutation ?? 'observe', ['storyboard.project'])
    case 'general': return semantics('observe', [])
  }
}
