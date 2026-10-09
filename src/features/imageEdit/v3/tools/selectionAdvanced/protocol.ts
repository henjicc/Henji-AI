import type { Coverage, RegionEvaluationContext, RegionGrid, RegionRect, RegionSnapshot } from '@/core/imaging/regions';
import type { SelectionAlgorithm, SelectionModification, SelectionPixels } from '@/core/imaging/regions/selectionAlgorithms';

export type AdvancedSelectionRequest = {
  grid: RegionGrid;
  context: Omit<RegionEvaluationContext, 'signal'>;
  operation: { kind: 'solve'; algorithm: SelectionAlgorithm } | { kind: 'modify'; mode: SelectionModification; radius: number };
};
export type AdvancedSelectionWorkerMessage =
  | { kind: 'read'; id: number; region: RegionRect; pixels: boolean }
  | { kind: 'progress'; completed: number; total: number }
  | { kind: 'result'; snapshot: RegionSnapshot }
  | { kind: 'error'; message: string };
export type AdvancedSelectionHostMessage =
  | { kind: 'start'; request: AdvancedSelectionRequest }
  | { kind: 'read-result'; id: number; value: SelectionPixels | Coverage; premultiplied?: boolean }
  | { kind: 'read-error'; id: number; message: string };
