import type { CharTable } from './generated/engine-break-data.js';
export type GraphemeTable = CharTable | 'gecko/char';
export declare function isBidiControl(cp: number): boolean;
export declare function findGraphemeEnds(table: GraphemeTable, text: string, start: number, end: number, ends: Int32Array | null): number;
//# sourceMappingURL=graphemes.d.ts.map