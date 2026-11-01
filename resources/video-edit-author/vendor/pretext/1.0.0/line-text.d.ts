import { type PreparedLineData } from './line-break.js';
export type PreparedSegments = PreparedLineData & {
    segments: string[];
};
export declare function getGraphemeEnds(prepared: PreparedSegments, segmentIndex: number): Int32Array;
export declare function buildRangeText(prepared: PreparedSegments, startSegmentIndex: number, startGraphemeIndex: number, endSegmentIndex: number, endGraphemeIndex: number): string;
export declare function buildLineTextFromRange(prepared: PreparedSegments, startSegmentIndex: number, startGraphemeIndex: number, endSegmentIndex: number, endGraphemeIndex: number): string;
//# sourceMappingURL=line-text.d.ts.map