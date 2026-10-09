import { describe, expect, it } from 'vitest';
import { filterStackCacheIdentity, moveFilter, removeFilter, updateFilter, type FilterInstance } from './index';
import type { EvaluationContext } from '../evaluation';

const stack: FilterInstance[] = ['first', 'second', 'third'].map(id => ({ id, operationType: 'effect', effectId: 'gaussian_blur', params: {}, enabled: true, opacity: 1, blendMode: 'normal', mask: null }));
describe('shared filter stack', () => {
  it('orders instances without modifying the source', () => {
    expect(moveFilter(stack, 'first', 2).map(f => f.id)).toEqual(['second', 'third', 'first']);
    expect(stack.map(f => f.id)).toEqual(['first', 'second', 'third']);
    expect(() => moveFilter(stack, 'missing', 0)).toThrow();
    expect(() => moveFilter(stack, 'first', 3)).toThrow();
  });
  it('changes and removes one stable instance', () => {
    expect(updateFilter(stack, 'second', { enabled: false })[1].enabled).toBe(false);
    expect(stack[1].enabled).toBe(true);
    expect(removeFilter(stack, 'second').map(f => f.id)).toEqual(['first', 'third']);
    expect(() => removeFilter(stack, 'missing')).toThrow();
  });
  it('binds cache identity to source time, scope and parameter values', () => {
    const context: EvaluationContext = { target: { kind: 'clip', id: 'one' }, sourceVersion: 'v1', time: { kind: 'static' }, referenceGrid: { width: 100, height: 80 }, roi: { x: 0, y: 0, width: 100, height: 80 }, color: { workingSpace: 'srgb', transferFunction: 'srgb', alpha: 'premultiplied', precision: 'float32' }, quality: 'final' };
    const initial = filterStackCacheIdentity(stack, context);
    expect(filterStackCacheIdentity(stack, { ...context, time: { kind: 'frame', ticks: 1, timeBase: [1, 24], frameId: '1' } })).not.toBe(initial);
    expect(filterStackCacheIdentity(moveFilter(stack, 'first', 2), context)).not.toBe(initial);
    expect(filterStackCacheIdentity(updateFilter(stack, 'first', { mask: { version: 'new' } }), context)).not.toBe(initial);
  });
});
