import type { LayoutCursor, LineStats } from './layout.js';
export type PreparedLineBreakData = {
    widths: number[];
    segmentFlags: Uint8Array;
    simpleLineWalkFastPath: boolean;
    simpleLineCountFastPath: boolean;
    breakableFitAdvances: (number[] | null)[];
    breakableLineStartExtras: (number[] | null)[] | null;
    lineStartExtras: number[] | null;
    lineEndTrims: number[] | null;
    overflowLineEndTrims: number[] | null;
    letterSpacing: number;
    discretionaryHyphenWidth: number;
    discretionaryHyphenContexts: number[] | null;
    tabStopAdvance: number;
    minimumTabAdvance: number;
};
export type PreparedLineData = PreparedLineBreakData & {
    items?: ParagraphSegmentData;
};
export type ParagraphSegmentData = {
    hyphenWidths: number[] | null;
    tabStopAdvances: number[] | null;
    minimumTabAdvances: number[] | null;
    hyphenRooms: number[] | null;
    itemEndHalts: number[] | null;
    insideExtras: number[] | null;
    fillExtras: number[] | null;
    openingEdges: number[] | null;
    emptyObjectSpaces: number[] | null;
    emptyObjectReturns: Uint8Array | null;
};
type InternalLineVisitor = (width: number, startSegmentIndex: number, startGraphemeIndex: number, endSegmentIndex: number, endGraphemeIndex: number) => void;
export declare function isDiscretionaryLineEnd(segmentFlags: Uint8Array, segmentCount: number, endSegmentIndex: number, endGraphemeIndex: number): boolean;
export declare function getItemTabAdvance(prepared: PreparedLineData, items: ParagraphSegmentData, index: number, lineWidth: number, appUnits: boolean): number;
export declare function normalizeMaxWidth(maxWidth: number): number;
export declare function normalizePreparedLineStart(prepared: PreparedLineData, cursor: LayoutCursor): boolean;
export declare function walkPreparedLinesRaw(prepared: PreparedLineData, maxWidth: number, onLine?: InternalLineVisitor, stats?: LineStats): number;
export declare function countPreparedLines(prepared: PreparedLineData, maxWidth: number): number;
export declare function stepPreparedLineGeometryFromStart(prepared: PreparedLineData, cursor: LayoutCursor, maxWidth: number): number | null;
export {};
//# sourceMappingURL=line-break.d.ts.map