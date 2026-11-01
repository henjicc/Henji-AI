import { type TextAnalysis } from './analysis.js';
import { type EngineProfile } from './measurement.js';
import type { PreparedText } from './layout.js';
import type { PreparedLineBreakData } from './line-break.js';
import type { PreparedSegments } from './line-text.js';
export declare const OTHER_SCRIPT = 1;
export declare const CYRILLIC_SCRIPT = 2;
export declare const GREEK_SCRIPT = 4;
export declare const LATIN_SCRIPT = 8;
export declare const CURSIVE_SCRIPT = 16;
export declare const ANY_SCRIPT = 31;
export declare const MARK_SCRIPTS_SHIFT = 5;
export declare const TAKES_MARK_SCRIPTS: number;
export declare const CURSIVE_LETTER: number;
export declare const OPENING_BRACKET: number;
export declare const CLOSING_BRACKET: number;
export declare const OPENING_BRACKET_SHIFT = 14;
export type ParagraphLists = {
    widths: number[];
    segmentFlags: Uint8Array;
    breakableFitAdvances: (number[] | null)[];
};
export declare function measureAnalysis(analysis: TextAnalysis, from: number, to: number, font: string, includeSegments: boolean, letterSpacing: number, engineProfile: EngineProfile, language: string | null, overflowBreaks: boolean, paragraph: ParagraphLists | null): (PreparedText & PreparedLineBreakData) | (PreparedText & PreparedSegments);
//# sourceMappingURL=prepare.d.ts.map