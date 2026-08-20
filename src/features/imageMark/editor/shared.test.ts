import { describe, expect, it } from 'vitest';
import { buildDraftMark, type DraftState } from './shared';

function arrowDraft(currentX: number, currentY: number): DraftState {
  return {
    tool: 'arrow',
    startX: 10,
    startY: 10,
    currentX,
    currentY,
    shiftKey: false,
  };
}

describe('buildDraftMark arrow', () => {
  it('does not render an arrow for a click or tiny pointer movement', () => {
    expect(buildDraftMark(arrowDraft(10, 10), 'red', 2)).toBeNull();
    expect(buildDraftMark(arrowDraft(12, 12), 'red', 2)).toBeNull();
  });

  it('renders an arrow after a real drag starts', () => {
    expect(buildDraftMark(arrowDraft(20, 10), 'red', 2)).toMatchObject({
      id: 'draft-arrow',
      type: 'arrow',
      points: [10, 10, 20, 10],
    });
  });
});

describe('buildDraftMark pen', () => {
  it('does not duplicate the latest sampled point', () => {
    expect(buildDraftMark({
      tool: 'pen',
      startX: 0,
      startY: 0,
      currentX: 10,
      currentY: 10,
      shiftKey: false,
      points: [0, 0, 10, 10],
    }, 'red', 2)).toMatchObject({
      type: 'pen',
      points: [0, 0, 10, 10],
    });
  });
});
