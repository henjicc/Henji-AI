import type { LookDescriptor } from '@/core/videoEdit/authorEffects.generated'
export * from './effects.generated'
export function look(name: string, knobs?: Readonly<Record<string, never>>): LookDescriptor {
  if (typeof name !== 'string' || !name.trim()) throw new Error('look.name 必须是非空名称。')
  if (knobs !== undefined && (!knobs || typeof knobs !== 'object' || Array.isArray(knobs) || Object.keys(knobs).length)) throw new Error('look 本版本不支持旋钮。')
  return { id: 'look', params: { name } }
}
