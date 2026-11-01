import type { LookDescriptor } from '@/core/videoEdit/authorEffects.generated'
export * from './effects.generated'
export function look(name: string, knobs?: Readonly<Record<string, number>>, options: { readonly key?: string } = {}): LookDescriptor {
  if (typeof name !== 'string' || !name.trim()) throw new Error('look.name 必须是非空名称。')
  if (knobs !== undefined && (!knobs || typeof knobs !== 'object' || Array.isArray(knobs) || Object.values(knobs).some(value => typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('look 旋钮必须是有限数值的对象。')
  return { id: 'look', ...options, params: { name, ...(knobs === undefined ? {} : { knobs: { ...knobs } }) } }
}
