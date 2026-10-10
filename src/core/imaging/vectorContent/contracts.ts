import type { RegionSampleTime } from '../regions';
import type { TextStyle } from './text';

/** A host samples animation before evaluation; image content is the static sample. */
export interface VectorEvaluationContext {
  sourceVersion: string;
  time: RegionSampleTime;
  referenceGrid: { width: number; height: number };
  quality: 'interactive' | 'final';
  signal?: AbortSignal;
}
export interface TextRun { text: string; style: TextStyle }
export interface TextParagraph {
  runs: TextRun[];
  align: TextStyle['align'];
  direction: 'auto' | 'ltr' | 'rtl';
  spaceBefore: number;
  spaceAfter: number;
}
/** Exact font names use the existing managed font catalog, never raw file paths. */
export interface RichTextContent {
  paragraphs: TextParagraph[];
  box: { x: number; y: number; width: number; height: number };
}
export type VectorPathCommand =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'line'; x: number; y: number }
  | { kind: 'quadratic'; x: number; y: number; cx: number; cy: number }
  | { kind: 'cubic'; x: number; y: number; cx1: number; cy1: number; cx2: number; cy2: number }
  | { kind: 'close' };
export interface VectorPath {
  commands: VectorPathCommand[];
  fillRule: 'nonzero' | 'evenodd';
}
export interface VectorPaint {
  fill: { enabled: boolean; color: string };
  strokes: TextStyle['strokes'];
  shadows: TextStyle['shadows'];
}
export interface VectorPathOperand { path: VectorPath; operation: 'replace' | 'add' | 'subtract' | 'intersect' }
export interface VectorPathContent { operands: VectorPathOperand[]; paint: VectorPaint }
