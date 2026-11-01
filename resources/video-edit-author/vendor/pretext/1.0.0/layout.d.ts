import { type SegmentBreakKind, type WhiteSpaceMode, type WordBreakMode as AnalysisWordBreakMode } from './analysis.js';
declare const preparedTextBrand: unique symbol;
export type PreparedText = {
    readonly [preparedTextBrand]: true;
};
export type PreparedTextWithSegments = PreparedText & {
    readonly segments: readonly string[];
    readonly kinds: readonly SegmentBreakKind[];
    readonly widths: ArrayLike<number>;
};
export type LayoutCursor = {
    segmentIndex: number;
    graphemeIndex: number;
};
export type LayoutResult = {
    lineCount: number;
    height: number;
};
export type LineStats = {
    lineCount: number;
    maxLineWidth: number;
};
export type LayoutLine = {
    text: string;
    width: number;
    start: LayoutCursor;
    end: LayoutCursor;
};
export type LayoutLineRange = {
    width: number;
    start: LayoutCursor;
    end: LayoutCursor;
};
export type LayoutLinesResult = LayoutResult & {
    lines: LayoutLine[];
};
export type WordBreakMode = AnalysisWordBreakMode;
export type PrepareOptions = {
    whiteSpace?: WhiteSpaceMode;
    wordBreak?: WordBreakMode;
    letterSpacing?: number;
};
export declare function prepare(text: string, font: string, options?: PrepareOptions): PreparedText;
export declare function prepareWithSegments(text: string, font: string, options?: PrepareOptions): PreparedTextWithSegments;
export declare function layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult;
export declare function materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine;
export declare function walkLineRanges(prepared: PreparedText, maxWidth: number, onLine: (line: LayoutLineRange) => void): number;
export declare function measureLineStats(prepared: PreparedText, maxWidth: number): LineStats;
export declare function measureNaturalWidth(prepared: PreparedText): number;
export declare function layoutNextLine(prepared: PreparedTextWithSegments, maxWidth: number, start?: LayoutCursor): LayoutLine | null;
export declare function layoutNextLineRange(prepared: PreparedText, maxWidth: number, start?: LayoutCursor): LayoutLineRange | null;
export declare function layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult;
export declare function clearCache(): void;
export declare function setLocale(locale?: string): void;
export {};
//# sourceMappingURL=layout.d.ts.map