import { evaluationCacheIdentity, type EvaluationContext } from '../evaluation';

/** Shared instance contract; mask storage and parameter evaluation belong to the host. */
export interface FilterInstance<Parameters = unknown, Mask = unknown> {
  id: string;
  operationType: 'effect' | 'adjustment';
  effectId: string;
  params: Parameters;
  enabled: boolean;
  opacity: number;
  blendMode: string;
  mask: Mask | null;
}

export function moveFilter<T extends FilterInstance>(stack: readonly T[], id: string, index: number): T[] {
  const from = stack.findIndex(filter => filter.id === id);
  if (from < 0) throw new Error('滤镜不存在，请重新选择');
  if (!Number.isSafeInteger(index) || index < 0 || index >= stack.length) throw new Error('滤镜顺序超出当前列表');
  const next = [...stack];
  next.splice(index, 0, next.splice(from, 1)[0]);
  return next;
}

export function updateFilter<T extends FilterInstance>(stack: readonly T[], id: string, patch: Partial<Omit<T, 'id'>>): T[] {
  if (!stack.some(filter => filter.id === id)) throw new Error('滤镜不存在，请重新选择');
  return stack.map(filter => filter.id === id ? { ...filter, ...patch } : filter);
}

export function removeFilter<T extends FilterInstance>(stack: readonly T[], id: string): T[] {
  if (!stack.some(filter => filter.id === id)) throw new Error('滤镜不存在，请重新选择');
  return stack.filter(filter => filter.id !== id);
}

/** The video host supplies values already evaluated at this source frame. */
export function filterStackCacheIdentity(stack: readonly FilterInstance[], context: EvaluationContext): string {
  return JSON.stringify([evaluationCacheIdentity(context), stack]);
}
