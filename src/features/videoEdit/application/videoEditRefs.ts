import type { ApplicationRef } from '@/core/application-control'

export function splitVideoEditRef(ref: ApplicationRef): { projectId: string; childId: string } {
  if (ref.kind === 'video_edit.document') return { projectId: ref.id, childId: '' }
  const index = ref.id.indexOf(':'); if (index < 0) throw new Error('请使用目录返回的完整剪辑实体引用。')
  return { projectId: ref.id.slice(0, index), childId: ref.id.slice(index + 1) }
}
