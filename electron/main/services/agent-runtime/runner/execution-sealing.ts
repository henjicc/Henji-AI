import { isMutatingEffect } from '../../../../../src/core/assistant/observedEffect'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'

/**
 * 还有什么拦着不让封存执行事实。返回 null 表示可以封存。
 *
 * 这里曾经有第一条 `settlement.status !== 'completed' → '任务图尚未完成'`：路由在模型动手
 * **之前**猜出一张 Facet 图，猜多了、猜错了域，运行就再也封存不了——用户要的东西明明做完
 * 并通过了正式状态源验证，最终却记成"未封存"。
 *
 * 也曾经有第五条 `unresolvedItems.length > 0 → 仍有未收敛事项`。它是同一个错误换了层皮：
 * **拿"做得好不好"当"停没停下来"**。实测生成场景——图片真的出图了、画布工程真的建了、
 * 8 个 Effect 有读回证据，模型多试了一次多余的脚本调用失败后自己判断"那步不必要"并收工，
 * 于是那次失败把已经发生的 8 项写入永久钉在 `pending` 上。拒绝封存并不能让写入回滚，
 * 只会把**已经发生的事实**从记录里抹掉，比记下来还糟。
 *
 * 剩下三条全是"这次运行客观上还没停下来"：手上还有活、还有审批没批、恢复检查没做完。
 * 未收敛事项不属于这一类——模型已经给出最终答复、已经停了，那是事实，该记进封存摘要
 * （见 `sealingCaveat`），由用户去判断做得对不对，不由运行时替他判决。
 */
export function executionSealingBlocker(input: {
  summary: AgentWorkingSummary | undefined
  effectCount: number
}): string | null {
  if (input.effectCount === 0) return '没有可封存的应用写入事实。'
  if (input.summary?.activeStep) return '仍有执行中的工具步骤。'
  if ((input.summary?.pendingApprovals.length ?? 0) > 0) return '仍有待处理的审批。'
  if (input.summary?.recovery.mode !== 'none') return input.summary?.recovery.reason || '恢复检查尚未完成。'
  return null
}

/**
 * 封存摘要里必须带上的保留意见：封存记录的是**发生了什么**，不是"一切顺利"。
 *
 * 未收敛事项不再挡住封存，但绝不能因此消失——否则就成了粉饰。返回空串表示没有保留意见。
 */
export function sealingCaveat(summary: AgentWorkingSummary | undefined): string {
  const items = summary?.unresolvedItems ?? []
  if (items.length === 0) return ''
  return `仍有未收敛事项：${items.join('；')}`
}

/**
 * 封存摘要：**说清写了什么、读了什么，不报只能是 0 的数。**
 *
 * 这句话踩过两个相反的坑，都记在这里免得再踩第三次：
 *
 * 1. 曾经把 `effects` 整体称作"应用写入"，而它包含 observe。实测一次**纯只读**的工具箱查询
 *    （8 段脚本全是 entities.read / entities.list）被报成"已完成 14 项应用写入"——用户问的是
 *    只读列表，拿到的却是一句凭空的写入声明。同一个口径还让 `--require-verified-write`
 *    被一次没有任何写入的运行满足。
 *
 * 2. 修完第一条后一度改成"其中 N 项有正式状态源读回证据"，只数写入里 `verified` 为真的。
 *    但 `verified` 完全由能力静态声明、运行时**没有任何地方**会把它翻成 true，而 14 处写入类
 *    Effect 声明里 `verified: true` 的有 **0 处**——读能力才声明 true（读本身就是验证）。
 *    于是这个数只能是 0，四个真机场景全都报"其中 0 项有读回证据"，看着像验证坏了，
 *    实际什么信息都没有。**一个只能取一个值的数字不是证据，是噪音。**
 *
 * 真正有信息量的是另一件事：写了却一次都没读回。所以这里报写入数与观察数，
 * 并在"有写入、零观察"时明说结果未经读回确认——那才是需要人看一眼的形状。
 */
export function sealingSummary(effects: readonly AgentObservedEffect[]): string {
  const mutations = effects.filter((effect) => isMutatingEffect(effect)).length
  const observations = effects.length - mutations
  if (mutations === 0) {
    return observations > 0
      ? `本次没有产生应用写入，只有 ${observations} 项读取或导航观察。`
      : '本次没有产生应用写入。'
  }
  return `已完成 ${mutations} 项应用写入`
    + (observations > 0
      ? `，另有 ${observations} 项读取或导航观察。`
      : '；本次没有任何读取观察，写入结果未经读回确认。')
}
