import { type GraphemeTable } from './graphemes.js';
export type WhiteSpaceMode = 'normal' | 'pre-wrap';
export type WordBreakMode = 'normal' | 'keep-all';
export type SegmentBreakKind = 'text' | 'space' | 'preserved-space' | 'tab' | 'zero-width-break' | 'soft-hyphen' | 'zero-width-glue' | 'hard-break' | 'control';
export declare const TEXT = 0;
export declare const SPACE = 1;
export declare const ZERO_WIDTH_BREAK = 2;
export declare const SOFT_HYPHEN = 3;
export declare const PRESERVED_SPACE = 4;
export declare const TAB = 5;
export declare const ZERO_WIDTH_GLUE = 6;
export declare const CONTROL = 7;
export declare const HARD_BREAK = 8;
export declare const OBJECT = 9;
export declare const KIND_BITS = 15;
export declare const SPACED = 16;
export declare const UNBROKEN = 32;
export declare const RETURNABLE = 64;
export declare const ONE_CLUSTER = 128;
export type SegmentKindCode = typeof TEXT | typeof SPACE | typeof ZERO_WIDTH_BREAK | typeof SOFT_HYPHEN | typeof PRESERVED_SPACE | typeof TAB | typeof ZERO_WIDTH_GLUE | typeof CONTROL | typeof HARD_BREAK;
export declare const SEGMENT_KINDS: readonly SegmentBreakKind[];
export type TextAnalysis = {
    normalized: string;
    spaceSources: Uint16Array | null;
    texts: string[];
    starts: number[];
    flags: number[];
    hasUnbroken: boolean;
};
export type AnalysisProfile = {
    lineBreakScan: 'blink' | 'webkit' | 'gecko';
    graphemeTable: GraphemeTable;
    hangTabs: boolean;
};
export type ParagraphItems = {
    items: readonly {
        text?: string;
    }[];
    starts: number[];
    atomic: boolean[];
    ownSegmentBreaks: boolean;
    sourceOffsets: Int32Array | null;
};
export declare function removeSkippableSegmentBreaks(text: string, profile: AnalysisProfile, language?: string | null): string;
export declare function isCollapsibleSpaceCode(code: number): boolean;
export declare function analyzeText(text: string, profile: AnalysisProfile, whiteSpace?: WhiteSpaceMode, wordBreak?: WordBreakMode, language?: string | null, paragraph?: ParagraphItems | null): TextAnalysis;
export declare function alignToSource(source: string, normalized: string, scan: AnalysisProfile['lineBreakScan']): Int32Array;
//# sourceMappingURL=analysis.d.ts.map