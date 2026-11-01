import { hasProperty, PUNCTUATION } from './line-breaks.js';
const OTHER = 0;
const OPEN = 1;
const CLOSE = 2;
const MIDDLE = 3;
const OPEN_NARROW = 4;
const CLOSE_NARROW = 5;
const DOT = 6;
const COLON = 7;
const SEMICOLON = 8;
const OPEN_QUOTE = 9;
const CLOSE_QUOTE = 10;
// Sticky, to test a code unit where it sits in the text.
const openPunctuationRe = /\p{Ps}/uy;
const closePunctuationRe = /\p{Pe}/uy;
// Character::MaybeHanKerningOpenOrCloseFast (character.h:138-141): every fullwidth opening
// and closing mark and every quote is in these ranges.
const maybeHanKerningRe = /[\u2018-\u301F\uFF08-\uFF60]/;
function maybeHanKerns(c) {
    return (c >= 0x2018 && c <= 0x301F) || (c >= 0xFF08 && c <= 0xFF60);
}
export function textMayHanKern(text) {
    return maybeHanKerningRe.test(text);
}
// HanKerningCharType (character_property_data_generator.cc:143-167, han_kerning_char_type.h:17-44)
// of the code unit at `index`: the listed quotes, dots, colon, semicolon and middles, then Ps and Pe,
// fullwidth when in the CJK Symbols block or East_Asian_Width F.
function getStaticCharType(text, index) {
    const c = text.charCodeAt(index);
    switch (c) {
        case 0x2018:
        case 0x201C: return OPEN_QUOTE;
        case 0x2019:
        case 0x201D: return CLOSE_QUOTE;
        case 0x3001:
        case 0x3002:
        case 0xFF0C:
        case 0xFF0E: return DOT;
        case 0xFF1A: return COLON;
        case 0xFF1B: return SEMICOLON;
        case 0x00B7:
        case 0x2027:
        case 0x3000:
        case 0x30FB: return MIDDLE;
        default: {
            if (c < 0x28 || !hasProperty(c, PUNCTUATION))
                return OTHER;
            const wide = (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF01 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6);
            openPunctuationRe.lastIndex = closePunctuationRe.lastIndex = index;
            if (openPunctuationRe.test(text))
                return wide ? OPEN : OPEN_NARROW;
            if (closePunctuationRe.test(text))
                return wide ? CLOSE : CLOSE_NARROW;
            return OTHER;
        }
    }
}
function getCharType(data, text, index) {
    const type = getStaticCharType(text, index);
    switch (type) {
        case DOT: return data.typeForDot;
        case COLON: return data.typeForColon;
        case SEMICOLON: return data.typeForSemicolon;
        case OPEN_QUOTE: return data.quoteFullwidth ? OPEN : OPEN_NARROW;
        case CLOSE_QUOTE: return data.quoteFullwidth ? CLOSE : CLOSE_NARROW;
        default: return type;
    }
}
// HanKerning::ShouldKern and ShouldKernLast (han_kerning.h:164-174): the halted character of
// the pair (earlier, later), 1 for the later, -1 for the earlier, 0 for neither.
function haltedSide(earlier, later) {
    if (later === OPEN && (earlier === OPEN || earlier === MIDDLE || earlier === CLOSE || earlier === OPEN_NARROW))
        return 1;
    if (earlier === CLOSE && (later === CLOSE || later === MIDDLE || later === CLOSE_NARROW))
        return -1;
    return 0;
}

export { getCharType, haltedSide };
export function typeFromExtents(advance, left, right) {
 const half = advance / 2;
 return right <= half ? CLOSE : left >= half ? OPEN : right - left <= half && left >= half / 2 ? MIDDLE : OTHER;
}
