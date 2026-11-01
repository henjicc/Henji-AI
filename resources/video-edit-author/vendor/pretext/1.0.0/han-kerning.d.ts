export interface HanKerningFontData { typeForDot: number; typeForColon: number; typeForSemicolon: number; quoteFullwidth: boolean }
export declare function getCharType(data: HanKerningFontData, text: string, index: number): number;
export declare function haltedSide(earlier: number, later: number): number;
export declare function typeFromExtents(advance: number, left: number, right: number): number;
