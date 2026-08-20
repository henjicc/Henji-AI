import { describe, expect, it } from 'vitest';
import { PEN_TENSION, penBoundsPoints, resolvePenTensionPoints } from './penGeometry';

describe('penGeometry', () => {
  it('creates smooth controls around a corner', () => {
    expect(resolvePenTensionPoints([0, 0, 10, 10, 20, 0])).toEqual([
      5,
      10,
      10,
      10,
      15,
      10,
    ]);
  });

  it('uses the same tension controls when resolving the selection bounds', () => {
    expect(PEN_TENSION).toBe(0.5);
    expect(penBoundsPoints([0, 0, 10, 10, 20, 0])).toEqual([
      0,
      0,
      5,
      10,
      10,
      10,
      15,
      10,
      20,
      0,
    ]);
  });

  it('keeps short strokes unchanged', () => {
    expect(penBoundsPoints([3, 4, 8, 9])).toEqual([3, 4, 8, 9]);
  });
});
