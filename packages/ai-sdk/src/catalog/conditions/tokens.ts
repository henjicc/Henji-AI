export type RuntimeConditionTokenKind =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'operator'
  | 'punctuation'
  | 'eof'

export interface RuntimeConditionToken {
  kind: RuntimeConditionTokenKind
  value: string | number | boolean
  offset: number
}

export class RuntimeConditionSyntaxError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(`${message} (offset ${offset})`)
    this.name = 'RuntimeConditionSyntaxError'
    this.offset = offset
  }
}

const THREE_CHAR_OPERATORS = new Set(['===', '!=='])
const TWO_CHAR_OPERATORS = new Set(['&&', '||', '>=', '<='])
const ONE_CHAR_OPERATORS = new Set(['!', '>', '<'])
const PUNCTUATION = new Set(['(', ')', '.', ','])

export function tokenizeRuntimeCondition(expression: string): RuntimeConditionToken[] {
  const tokens: RuntimeConditionToken[] = []
  let offset = 0

  while (offset < expression.length) {
    const character = expression[offset]
    if (/\s/u.test(character)) {
      offset += 1
      continue
    }

    const three = expression.slice(offset, offset + 3)
    if (THREE_CHAR_OPERATORS.has(three)) {
      tokens.push({ kind: 'operator', value: three, offset })
      offset += 3
      continue
    }

    const two = expression.slice(offset, offset + 2)
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({ kind: 'operator', value: two, offset })
      offset += 2
      continue
    }

    if (ONE_CHAR_OPERATORS.has(character)) {
      tokens.push({ kind: 'operator', value: character, offset })
      offset += 1
      continue
    }

    if (PUNCTUATION.has(character)) {
      tokens.push({ kind: 'punctuation', value: character, offset })
      offset += 1
      continue
    }

    if (character === '"' || character === "'") {
      const start = offset
      const quote = character
      let value = ''
      offset += 1
      while (offset < expression.length && expression[offset] !== quote) {
        if (expression[offset] === '\\') {
          throw new RuntimeConditionSyntaxError('Escape sequences are not supported', offset)
        }
        value += expression[offset]
        offset += 1
      }
      if (expression[offset] !== quote) {
        throw new RuntimeConditionSyntaxError('Unterminated string literal', start)
      }
      offset += 1
      tokens.push({ kind: 'string', value, offset: start })
      continue
    }

    const numberMatch = expression.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?/u)
    if (numberMatch) {
      tokens.push({ kind: 'number', value: Number(numberMatch[0]), offset })
      offset += numberMatch[0].length
      continue
    }

    const identifierMatch = expression.slice(offset).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u)
    if (identifierMatch) {
      const value = identifierMatch[0]
      if (value === 'true' || value === 'false') {
        tokens.push({ kind: 'boolean', value: value === 'true', offset })
      } else if (value === 'typeof') {
        tokens.push({ kind: 'operator', value, offset })
      } else {
        tokens.push({ kind: 'identifier', value, offset })
      }
      offset += value.length
      continue
    }

    throw new RuntimeConditionSyntaxError(`Unsupported token ${JSON.stringify(character)}`, offset)
  }

  tokens.push({ kind: 'eof', value: '', offset: expression.length })
  return tokens
}
