import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import type { OperationReviewItem } from '../../../../src/core/application-control/operationReview'
import type { OperationRecord } from './operationStore'
import { isExecutedVerificationFailure } from './operationVerificationRecovery'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function reviewPresentation(record: OperationRecord, observations: Record<string, unknown>[] = []): OperationReviewItem {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(record.capabilityId)
  const snapshots = observations.filter(value => value.ok === true).map(value => object(value.data))
  const summary = snapshots.map(value => object(value.reviewSummary)).find(value => typeof value.name === 'string')
  const names = snapshots.flatMap(value => {
    const properties = object(value.properties)
    const name = value.label ?? value.name ?? Object.entries(properties).find(([key]) => key.endsWith('.name'))?.[1]
    return typeof name === 'string' && name.trim() ? [name] : []
  })
  const title = definition?.title ?? '修改应用内容'
  const description = summary ? `${title}（序列“${summary.name}”）` : names.length ? `${title}（“${[...new Set(names)].join('、')}”）` : title
  const actor = record.origin?.actor === 'embedded' ? '内置助手' : record.origin?.actor === 'user' ? '你' : record.origin ? '外部 AI' : 'AI'
  const time = record.origin ? new Date(record.origin.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const error = object(record.result?.error)
  // 有失败回执说明操作已经结束、只是不确定改了多少；没有回执才是真的中途断掉，不能把前者说成“应用重新加载”。
  const interrupted = !record.result || error.code === 'DEADLINE_EXCEEDED' || error.code === 'CONNECTION_INTERRUPTED'
  const reason = error.code === 'DEADLINE_EXCEEDED' ? '执行超时' : error.code === 'CONNECTION_INTERRUPTED' ? '连接中断' : '应用重新加载'
  // 失败原因只在是给人看的中文时引用；英文底层报错（文件系统、解析器）不展示。
  const errorMessage = typeof error.message === 'string' && /[㐀-鿿]/.test(error.message) ? error.message.replace(/^[A-Z_]+[:：]\s*/, '').slice(0, 120) : ''
  const happened = interrupted ? `执行到一半时${reason}，没能确认结果。` : `执行时出错${errorMessage ? `：${errorMessage}` : ''}。软件没法自动确定它改动了多少。`
  // 状态摘要只使用已读回的人可感知字段，不把属性表、ID 或 revision 展示给用户。
  const situation = typeof summary?.situation === 'string' ? summary.situation : snapshots.length ? '已读取目标的当前内容，请查看原文档核对。' : '没能读取目标的当前情况。'
  const executed = isExecutedVerificationFailure(record)
  const guidance = executed ? '' : '\n\n看一下目标：没有改动就选“没有生效”，AI 可以重新做；已经改好了就选“已经生效”，AI 不会再做一次。'
  return { operationId: record.operationId, callerId: record.callerId, executed, title: executed ? '请核对已执行的修改' : '这次修改生效了吗？',
    message: `${actor}${time ? ` 在 ${time}` : ''} 请求「${description}」，\n${executed ? '修改已执行，但没能自动核实结果。请查看原文档，确认后可继续编辑；这不会重复执行修改。' : happened}\n\n现在的情况：${situation}${guidance}`,
    targets: record.targetRefs ?? [],
  }
}
