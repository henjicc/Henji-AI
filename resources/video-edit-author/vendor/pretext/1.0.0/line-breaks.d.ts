import { type ClassMap, type RuleTable } from './generated/engine-break-data.js';
export declare const BREAK = 1;
export declare const CLUSTER_START = 2;
export declare const FORCED_BREAK = 4;
export declare const SOFT_HYPHEN_BREAK = 8;
export declare const ITEM_START = 16;
type BreakLanguage = 'root' | 'ja' | 'ko' | 'zh';
export declare function getBreakLanguage(tag: string | null): BreakLanguage;
export declare function unpackTable(packed: string): Uint8Array;
export declare function unpackVarints(base64: string): Int32Array;
export type ClassTable = {
    readonly index: Uint16Array;
    readonly values: Uint8Array;
};
export declare function getClass(table: ClassTable, c: number): number;
export declare function unpackClassRuns(runs: Int32Array, remap: Uint8Array, blocks: number): ClassTable;
export declare function unpackClasses(map: ClassMap): ClassTable;
export declare function lazyRegExp(source: string, flags: string): () => RegExp;
export declare const LETTER_OR_NUMBER = 0;
export declare const MARK = 1;
export declare const PUNCTUATION = 2;
export declare const PUNCTUATION_BUT_DASH_OR_CONNECTOR = 3;
export declare const DEFAULT_IGNORABLE = 4;
export declare const EMOJI = 5;
export declare const HANGUL = 6;
export declare function hasProperty(cp: number, property: number): boolean;
export declare function getWordSegmenter(): Intl.Segmenter;
export declare function clearWordSegmenter(): void;
export declare const START_STATE = 1;
export type BreakRules = {
    catCount: number;
    dictCategoriesStart: number;
    rowWidth: number;
    rows: Uint16Array;
    lookAheadResultsSize: number;
    classes: ClassTable;
};
export declare function unpackStateRows(width: number, states: number, base: Uint16Array | null, differences: Int32Array): Uint16Array;
export declare function getBreakRules(table: RuleTable): BreakRules;
type CategoryOverrides = {
    readonly chars: readonly number[];
    readonly categories: readonly number[];
};
export declare function markRuleBoundaries(r: BreakRules, text: string, flags: Uint8Array, overrides?: CategoryOverrides): void;
export declare function getBlinkDefaultLocale(): string;
export declare function getBlinkLineBreaks(text: string, keepAll: boolean, language: string | null): Uint8Array;
type WebKitLineRules = {
    readonly rules: BreakRules;
    readonly overrides: CategoryOverrides;
};
export declare function getWebKitLineRules(language: string | null): WebKitLineRules;
export declare function getWebKitLineBreaks(source: string, preserveNewlines: boolean, keepAll: boolean, language: string | null): Uint8Array;
export declare function getWebKitBreakBetweenItems(previous: string, next: string, keepAll: boolean, language: string | null): boolean;
export {};
//# sourceMappingURL=line-breaks.d.ts.map