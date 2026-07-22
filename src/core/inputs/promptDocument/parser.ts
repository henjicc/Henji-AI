import type { PromptDocumentV1, PromptInlineNodeV1 } from './types'
import type {
  LegacyPromptParseOptions,
  LegacyPromptReference,
  LegacyPromptVariable,
} from './serializationTypes'

interface ParsedToken {
  text: string
  node: PromptInlineNodeV1
  rejectFollowingDigit: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueByLabel(
  references: readonly LegacyPromptReference[],
): ReadonlyMap<string, LegacyPromptReference> {
  const grouped = new Map<string, LegacyPromptReference[]>()
  references.forEach((reference) => {
    const current = grouped.get(reference.label) ?? []
    current.push(reference)
    grouped.set(reference.label, current)
  })

  const unique = new Map<string, LegacyPromptReference>()
  grouped.forEach((items, label) => {
    if (items.length === 1) unique.set(label, items[0])
  })
  return unique
}

function uniqueByKey(
  variables: readonly LegacyPromptVariable[],
): ReadonlyMap<string, LegacyPromptVariable> {
  const grouped = new Map<string, LegacyPromptVariable[]>()
  variables.forEach((variable) => {
    const current = grouped.get(variable.key) ?? []
    current.push(variable)
    grouped.set(variable.key, current)
  })

  const unique = new Map<string, LegacyPromptVariable>()
  grouped.forEach((items, key) => {
    if (items.length === 1) unique.set(key, items[0])
  })
  return unique
}

function createParsedTokens(options: LegacyPromptParseOptions): ParsedToken[] {
  const tokens: ParsedToken[] = []
  uniqueByLabel(options.references ?? []).forEach((reference, label) => {
    if (!reference.resourceId.trim() || !label.trim()) return
    const node: PromptInlineNodeV1 = {
      type: 'mediaReference',
      attrs: {
        resourceId: reference.resourceId,
        mediaType: reference.mediaType,
        fallbackLabel: reference.label,
        ...(reference.sourceNodeId ? { sourceNodeId: reference.sourceNodeId } : {}),
      },
    }
    tokens.push({ text: `@${label}`, node, rejectFollowingDigit: /\d$/.test(label) })
    tokens.push({ text: label, node, rejectFollowingDigit: /\d$/.test(label) })
  })
  uniqueByKey(options.variables ?? []).forEach((variable, key) => {
    if (!key.trim() || !variable.label.trim()) return
    tokens.push({
      text: `{{${key}}}`,
      node: {
        type: 'templateVariable',
        attrs: { key, fallbackLabel: variable.label },
      },
      rejectFollowingDigit: false,
    })
  })
  return tokens.sort((left, right) => right.text.length - left.text.length)
}

function pushText(content: PromptInlineNodeV1[], text: string): void {
  if (!text) return
  const previous = content[content.length - 1]
  if (previous?.type === 'text') {
    previous.text += text
    return
  }
  content.push({ type: 'text', text })
}

export function parseLegacyPromptString(
  legacyText: string,
  options: LegacyPromptParseOptions = {},
): PromptDocumentV1 {
  const tokens = createParsedTokens(options)
  const tokenByText = new Map(tokens.map((token) => [token.text, token]))
  const pattern = tokens.length
    ? new RegExp(tokens.map((token) => escapeRegExp(token.text)).join('|'), 'g')
    : null
  const content: PromptInlineNodeV1[] = []
  let lastIndex = 0

  if (pattern) {
    let match = pattern.exec(legacyText)
    while (match) {
      const token = tokenByText.get(match[0])
      const nextCharacter = legacyText[match.index + match[0].length]
      if (token && !(token.rejectFollowingDigit && /\d/.test(nextCharacter ?? ''))) {
        pushText(content, legacyText.slice(lastIndex, match.index))
        content.push(token.node)
        lastIndex = match.index + match[0].length
      }
      match = pattern.exec(legacyText)
    }
  }
  pushText(content, legacyText.slice(lastIndex))

  const withBreaks: PromptInlineNodeV1[] = []
  content.forEach((node) => {
    if (node.type !== 'text' || !node.text.includes('\n')) {
      withBreaks.push(node)
      return
    }
    const lines = node.text.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) withBreaks.push({ type: 'hardBreak' })
      pushText(withBreaks, line)
    })
  })

  return {
    version: 1,
    type: 'doc',
    content: [{
      type: 'paragraph',
      ...(withBreaks.length ? { content: withBreaks } : {}),
    }],
  }
}
