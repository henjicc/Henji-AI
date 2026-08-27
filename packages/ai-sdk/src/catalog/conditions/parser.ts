import {
  RuntimeConditionSyntaxError,
  tokenizeRuntimeCondition,
  type RuntimeConditionToken,
} from './tokens'

export type RuntimeConditionNode =
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'reference'; path: string[] }
  | { kind: 'unary'; operator: '!' | 'typeof'; operand: RuntimeConditionNode }
  | {
      kind: 'binary'
      operator: '&&' | '||' | '===' | '!==' | '>' | '<' | '>=' | '<='
      left: RuntimeConditionNode
      right: RuntimeConditionNode
    }
  | { kind: 'array-is-array'; value: RuntimeConditionNode }

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '===': 3,
  '!==': 3,
  '>': 4,
  '<': 4,
  '>=': 4,
  '<=': 4,
}

type BinaryOperator = Extract<RuntimeConditionNode, { kind: 'binary' }>['operator']

export function parseRuntimeCondition(expression: string): RuntimeConditionNode {
  const parser = new RuntimeConditionParser(tokenizeRuntimeCondition(expression))
  return parser.parse()
}

class RuntimeConditionParser {
  private cursor = 0

  constructor(private readonly tokens: RuntimeConditionToken[]) {}

  parse(): RuntimeConditionNode {
    const result = this.parseBinary(1)
    const trailing = this.peek()
    if (trailing.kind !== 'eof') {
      throw new RuntimeConditionSyntaxError(`Unexpected token ${String(trailing.value)}`, trailing.offset)
    }
    return result
  }

  private parseBinary(minimumPrecedence: number): RuntimeConditionNode {
    let left = this.parseUnary()
    while (this.cursor < this.tokens.length) {
      const token = this.peek()
      if (token.kind !== 'operator') break
      const operator = String(token.value)
      const precedence = BINARY_PRECEDENCE[operator]
      if (precedence === undefined || precedence < minimumPrecedence) break
      this.cursor += 1
      const right = this.parseBinary(precedence + 1)
      left = { kind: 'binary', operator: operator as BinaryOperator, left, right }
    }
    return left
  }

  private parseUnary(): RuntimeConditionNode {
    const token = this.peek()
    if (token.kind === 'operator' && (token.value === '!' || token.value === 'typeof')) {
      this.cursor += 1
      return {
        kind: 'unary',
        operator: token.value,
        operand: this.parseUnary(),
      }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): RuntimeConditionNode {
    const token = this.peek()
    if (token.kind === 'string' || token.kind === 'number' || token.kind === 'boolean') {
      this.cursor += 1
      return { kind: 'literal', value: token.value }
    }

    if (token.kind === 'punctuation' && token.value === '(') {
      this.cursor += 1
      const expression = this.parseBinary(1)
      this.expect('punctuation', ')')
      return expression
    }

    if (token.kind === 'identifier') {
      return this.parseReferenceOrCall()
    }

    throw new RuntimeConditionSyntaxError(`Expected a value, got ${String(token.value)}`, token.offset)
  }

  private parseReferenceOrCall(): RuntimeConditionNode {
    const first = this.expect('identifier')
    const path = [String(first.value)]
    while (this.peek().kind === 'punctuation' && this.peek().value === '.') {
      this.cursor += 1
      path.push(String(this.expect('identifier').value))
    }

    if (this.peek().kind === 'punctuation' && this.peek().value === '(') {
      if (path.join('.') !== 'Array.isArray') {
        throw new RuntimeConditionSyntaxError(`Unsupported call ${path.join('.')}`, first.offset)
      }
      this.cursor += 1
      const value = this.parseBinary(1)
      this.expect('punctuation', ')')
      return { kind: 'array-is-array', value }
    }

    if (path.length > 1 && (path.length !== 2 || path[1] !== 'length')) {
      throw new RuntimeConditionSyntaxError(`Unsupported property ${path.join('.')}`, first.offset)
    }
    return { kind: 'reference', path }
  }

  private peek(): RuntimeConditionToken {
    return this.tokens[this.cursor]
  }

  private expect(kind: RuntimeConditionToken['kind'], value?: string): RuntimeConditionToken {
    const token = this.peek()
    if (token.kind !== kind || (value !== undefined && token.value !== value)) {
      throw new RuntimeConditionSyntaxError(
        `Expected ${value ?? kind}, got ${String(token.value)}`,
        token.offset
      )
    }
    this.cursor += 1
    return token
  }
}
