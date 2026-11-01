import { type GraphemeTable } from './graphemes.js';
export declare function isDiscardable(ch: number, is8bit: boolean): boolean;
export declare const isSpaceOrTabOrSegmentBreak: (ch: number) => ch is 9 | 10 | 32;
export declare function isSpaceCombiningSequenceTail(text: string, from: number): boolean;
export declare function isJapaneseOrChinese(language: string | null): boolean;
export declare function isEastAsianSegmentBreak(text: string, start: number, end: number, japaneseOrChinese: boolean): boolean;
export type GeckoLineBreaks = {
    breaks: Uint8Array;
    leftOut: Uint8Array | null;
    dropsBidiControl: boolean;
};
export declare function getGeckoLineBreaks(source: string, preserveWhiteSpace: boolean, keepAll: boolean, graphemeTable: GraphemeTable, frameStarts?: number[] | null): GeckoLineBreaks;
//# sourceMappingURL=gecko-line-breaks.d.ts.map