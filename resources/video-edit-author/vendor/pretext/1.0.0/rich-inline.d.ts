import type { LayoutCursor, WordBreakMode } from './layout.js';
import { type WhiteSpaceMode } from './analysis.js';
declare const preparedRichInlineBrand: unique symbol;
export type RichInlineItem = {
    text: string;
    font: string;
    letterSpacing?: number;
    break?: 'normal' | 'never';
    extraWidth?: number;
    width?: never;
};
export type RichInlineBox = {
    width: number;
    text?: never;
};
export type RichInlineOptions = {
    whiteSpace?: WhiteSpaceMode;
    wordBreak?: WordBreakMode;
};
export type PreparedRichInline = {
    readonly [preparedRichInlineBrand]: true;
};
export type RichInlineCursor = {
    itemIndex: number;
    segmentIndex: number;
    graphemeIndex: number;
};
export type RichInlineFragment = {
    itemIndex: number;
    text: string;
    gapBefore: number;
    gapItemIndex: number;
    occupiedWidth: number;
    sourceStart: number;
    sourceEnd: number;
};
export type RichInlineFragmentRange = {
    itemIndex: number;
    gapBefore: number;
    gapItemIndex: number;
    occupiedWidth: number;
    start: LayoutCursor;
    end: LayoutCursor;
};
export type RichInlineLine = {
    fragments: RichInlineFragment[];
    width: number;
    end: RichInlineCursor;
};
export type RichInlineLineRange = {
    fragments: RichInlineFragmentRange[];
    width: number;
    end: RichInlineCursor;
};
export type RichInlineStats = {
    lineCount: number;
    maxLineWidth: number;
};
export declare function prepareRichInline(items: Array<RichInlineItem | RichInlineBox>, options?: RichInlineOptions): PreparedRichInline;
export declare function layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null;
export declare function materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine;
export declare function walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number;
export declare function measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): RichInlineStats;
export {};
//# sourceMappingURL=rich-inline.d.ts.map