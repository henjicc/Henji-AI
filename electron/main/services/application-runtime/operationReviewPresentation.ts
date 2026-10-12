import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import type { OperationReviewItem } from '../../../../src/core/application-control/operationReview'
import type { OperationRecord } from './operationStore'

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
  const reason = error.code === 'DEADLINE_EXCEEDED' ? '执行超时' : error.code === 'CONNECTION_INTERRUPTED' ? '连接中断' : '应用重新加载'
  // 状态摘要只使用已读回的人可感知字段，不把属性表、ID 或 revision 展示给用户。
  const situation = typeof summary?.situation === 'string' ? summary.situation : snapshots.length ? '已读取目标的当前内容，请查看原文档核对。' : '没能读取目标的当前情况。'
  return { operationId: record.operationId, callerId: record.callerId, title: '这次修改生效了吗？',
    message: `${actor}${time ? ` 在 ${time}` : ''} 请求「${description}」，\n执行到一半时${reason}，没能确认结果。\n\n现在的情况：${situation}`,
    targets: record.targetRefs ?? [],
  }
}
