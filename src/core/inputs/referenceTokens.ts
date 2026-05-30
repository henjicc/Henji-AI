export type DeleteDirection = 'backward' | 'forward';

export interface TextRange {
  start: number;
  end: number;
}

export interface NormalizedTextResult {
  nextText: string;
  nextCursor: number;
  changed: boolean;
}

interface TokenRange extends TextRange {
  blockStart: number;
  blockEnd: number;
}

const IMAGE_REFERENCE_TOKEN_REGEX = /@图\d+/g;
const IMAGE_REFERENCE_PREFIX_REGEX = /@(?=\s*图\d+)/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTokenRegex(referenceLabels?: string[], tokenPrefix = '@', literalTokens?: string[]): RegExp {
  const referenceTokens = (referenceLabels ?? [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .map((label) => `${tokenPrefix}${label}`);
  const tokens = [...(literalTokens ?? []), ...referenceTokens];
  const values = Array.from(
    new Set(tokens.map((token) => token.trim()).filter((token) => token.length > 0))
  ).sort((a, b) => b.length - a.length);

  if (values.length === 0) {
    return IMAGE_REFERENCE_TOKEN_REGEX;
  }

  return new RegExp(values.map((token) => escapeRegExp(token)).join('|'), 'g');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findTokenRanges(text: string, referenceLabels?: string[], tokenPrefix = '@', literalTokens?: string[]): TokenRange[] {
  const ranges: TokenRange[] = [];
  const tokenRegex = createTokenRegex(referenceLabels, tokenPrefix, literalTokens);
  tokenRegex.lastIndex = 0;
  let match = tokenRegex.exec(text);
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

    match = tokenRegex.exec(text);
  }

  return ranges;
}

export function stripReferenceAtPrefix(text: string): string {
  return text.replace(IMAGE_REFERENCE_PREFIX_REGEX, '');
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

export function normalizeReferenceTokenSpacing(
  text: string,
  cursor: number,
  referenceLabels?: string[],
  tokenPrefix = '@',
  literalTokens?: string[]
): NormalizedTextResult {
  const safeCursor = clamp(cursor, 0, text.length);
  const segments: string[] = [];
  let changed = false;
  let nextCursor = safeCursor;
  let lastIndex = 0;
  let previousTokenEnd = -1;
  let previousAddedTrailingSpace = false;

  const tokenRegex = createTokenRegex(referenceLabels, tokenPrefix, literalTokens);
  tokenRegex.lastIndex = 0;
  let match = tokenRegex.exec(text);
  while (match) {
    const tokenText = match[0];
    const tokenStart = match.index;
    const tokenEnd = tokenStart + tokenText.length;
    const isAdjacentToPreviousToken = previousTokenEnd === tokenStart;
    const shouldAddLeadingSpace = tokenStart > 0
      && !/\s/.test(text[tokenStart - 1])
      && !(isAdjacentToPreviousToken && previousAddedTrailingSpace);

    segments.push(text.slice(lastIndex, tokenStart));

    if (shouldAddLeadingSpace) {
      segments.push(' ');
      changed = true;
      if (nextCursor > tokenStart) {
        nextCursor += 1;
      }
    }

    segments.push(tokenText);

    const shouldAddTrailingSpace = tokenEnd < text.length && !/\s/.test(text[tokenEnd]);
    if (shouldAddTrailingSpace) {
      segments.push(' ');
      changed = true;
      if (nextCursor >= tokenEnd) {
        nextCursor += 1;
      }
    }

    lastIndex = tokenEnd;
    previousTokenEnd = tokenEnd;
    previousAddedTrailingSpace = shouldAddTrailingSpace;
    match = tokenRegex.exec(text);
  }

  if (!changed) {
    return { nextText: text, nextCursor: safeCursor, changed: false };
  }

  segments.push(text.slice(lastIndex));
  const nextText = segments.join('');
  return {
    nextText,
    nextCursor: clamp(nextCursor, 0, nextText.length),
    changed: true,
  };
}

export function resolveReferenceAwareDeleteRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  direction: DeleteDirection,
  referenceLabels?: string[],
  tokenPrefix = '@',
  literalTokens?: string[]
): TextRange | null {
  const safeStart = clamp(selectionStart, 0, text.length);
  const safeEnd = clamp(selectionEnd, 0, text.length);
  const selectionMin = Math.min(safeStart, safeEnd);
  const selectionMax = Math.max(safeStart, safeEnd);
  const tokenRanges = findTokenRanges(text, referenceLabels, tokenPrefix, literalTokens);

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
