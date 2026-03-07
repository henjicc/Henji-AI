export type DeleteDirection = 'backward' | 'forward';

export interface TextRange {
  start: number;
  end: number;
}

interface TokenRange extends TextRange {
  blockStart: number;
  blockEnd: number;
}

const IMAGE_REFERENCE_TOKEN_REGEX = /@图\d+/g;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findTokenRanges(text: string): TokenRange[] {
  const ranges: TokenRange[] = [];
  IMAGE_REFERENCE_TOKEN_REGEX.lastIndex = 0;
  let match = IMAGE_REFERENCE_TOKEN_REGEX.exec(text);
  while (match) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    const blockStart = start > 0 && text[start - 1] === ' ' ? start - 1 : start;
    const blockEnd = end < text.length && text[end] === ' ' ? end + 1 : end;

    ranges.push({
      start,
      end,
      blockStart,
      blockEnd,
    });

    match = IMAGE_REFERENCE_TOKEN_REGEX.exec(text);
  }

  return ranges;
}

export function insertReferenceToken(
  text: string,
  cursor: number,
  marker: string
): { nextText: string; nextCursor: number } {
  const safeCursor = clamp(cursor, 0, text.length);
  const before = text.slice(0, safeCursor);
  const after = text.slice(safeCursor);
  const previousChar = before.length > 0 ? before.charAt(before.length - 1) : '';
  const nextChar = after.length > 0 ? after.charAt(0) : '';
  const needsLeadingSpace = before.length > 0 && !/\s/.test(previousChar);
  const needsTrailingSpace = after.length > 0 && !/\s/.test(nextChar);
  const insertion = `${needsLeadingSpace ? ' ' : ''}${marker}${needsTrailingSpace ? ' ' : ''}`;

  return {
    nextText: `${before}${insertion}${after}`,
    nextCursor: before.length + insertion.length,
  };
}

export function resolveReferenceAwareDeleteRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: DeleteDirection
): TextRange | null {
  const safeStart = clamp(selectionStart, 0, text.length);
  const safeEnd = clamp(selectionEnd, 0, text.length);
  const selectionMin = Math.min(safeStart, safeEnd);
  const selectionMax = Math.max(safeStart, safeEnd);
  const tokenRanges = findTokenRanges(text);

  if (selectionMin !== selectionMax) {
    let expandedStart = selectionMin;
    let expandedEnd = selectionMax;
    let touchedToken = false;

    for (const tokenRange of tokenRanges) {
      if (tokenRange.blockEnd <= expandedStart || tokenRange.blockStart >= expandedEnd) {
        continue;
      }

      touchedToken = true;
      expandedStart = Math.min(expandedStart, tokenRange.blockStart);
      expandedEnd = Math.max(expandedEnd, tokenRange.blockEnd);
    }

    if (!touchedToken) {
      return null;
    }

    return {
      start: expandedStart,
      end: expandedEnd,
    };
  }

  const point = direction === 'backward'
    ? Math.max(0, selectionMin - 1)
    : selectionMin;

  for (const tokenRange of tokenRanges) {
    if (point >= tokenRange.blockStart && point < tokenRange.blockEnd) {
      return {
        start: tokenRange.blockStart,
        end: tokenRange.blockEnd,
      };
    }
  }

  return null;
}

export function removeTextRange(
  text: string,
  range: TextRange
): { nextText: string; nextCursor: number } {
  const safeStart = clamp(Math.min(range.start, range.end), 0, text.length);
  const safeEnd = clamp(Math.max(range.start, range.end), 0, text.length);
  const before = text.slice(0, safeStart);
  const after = text.slice(safeEnd);

  if (before.endsWith(' ') && after.startsWith(' ')) {
    return {
      nextText: `${before}${after.slice(1)}`,
      nextCursor: safeStart,
    };
  }

  return {
    nextText: `${before}${after}`,
    nextCursor: safeStart,
  };
}
