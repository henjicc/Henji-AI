import type { ApplicationCollectionAvailability } from '../reflection'

function recoveryText(availability: ApplicationCollectionAvailability['create']): string {
  if (availability.recoveries.length === 0) return ''
  return `；可用恢复：${availability.recoveries.map((recovery) => {
    const identifiers = [
      ...recovery.capabilityIds.map((id) => `能力 ${id}`),
      ...recovery.entityTypes.map((id) => `实体 ${id}`),
      ...recovery.propertyIds.map((id) => `属性 ${id}`),
    ]
    return `${recovery.summary}${identifiers.length > 0 ? `（${identifiers.join('、')}）` : ''}`
  }).join('；')}`
}

/** plan、commit 预检与执行前复核共用同一错误协议。 */
export function assertCollectionOperationAvailable(
  availability: ApplicationCollectionAvailability,
  operation: 'create' | 'remove',
): void {
  const current = availability[operation]
  if (current.available) return
  const code = operation === 'create'
    ? 'COLLECTION_CREATE_NOT_AVAILABLE'
    : 'COLLECTION_REMOVE_NOT_AVAILABLE'
  throw new Error(
    `${code}:${availability.entityType}`
    + `${current.reasons.length > 0 ? `（${current.reasons.join('；')}）` : ''}`
    + recoveryText(current),
  )
}
