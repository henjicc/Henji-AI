import {
  mergeAttributes,
  Node,
  type Editor,
  type Range,
} from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'

import { TemplateVariableNodeView } from '../nodeViews/ReferenceNodeViews'
import { PromptEditorResourceRegistry } from '../resourceRegistry'
import { createSuggestionRenderer } from '../suggestions/createSuggestionRenderer'
import type { PromptSuggestionItem } from '../suggestions/PromptSuggestionList'
import type { PromptVariableItem } from '../types'

export interface TemplateVariableExtensionOptions {
  registry: PromptEditorResourceRegistry
}

interface TemplateVariableAttributes {
  key: string
  fallbackLabel: string
}

const templateVariableSuggestionKey = new PluginKey('promptTemplateVariableSuggestion')

function readAttributes(attrs: Record<string, unknown>): TemplateVariableAttributes {
  return {
    key: typeof attrs.key === 'string' ? attrs.key : '',
    fallbackLabel: typeof attrs.fallbackLabel === 'string'
      ? attrs.fallbackLabel
      : '失效变量',
  }
}

function insertTemplateVariable(
  editor: Editor,
  range: Range,
  variable: PromptVariableItem,
): void {
  editor.chain()
    .focus()
    .insertContentAt(range, [
      {
        type: 'templateVariable',
        attrs: {
          key: variable.key,
          fallbackLabel: variable.label,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run()
}

export const TemplateVariableExtension = Node.create<TemplateVariableExtensionOptions>({
  name: 'templateVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { registry: new PromptEditorResourceRegistry() }
  },

  addAttributes() {
    return {
      key: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-variable-key') ?? '',
        renderHTML: (attributes) => ({
          'data-variable-key': readAttributes(attributes).key,
        }),
      },
      fallbackLabel: {
        default: '失效变量',
        parseHTML: (element) => element.getAttribute('data-fallback-label') ?? '失效变量',
        renderHTML: (attributes) => ({
          'data-fallback-label': readAttributes(attributes).fallbackLabel,
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-prompt-template-variable]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = readAttributes(node.attrs)
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-prompt-template-variable': '' }),
      `{{${attrs.key}}}`,
    ]
  },

  renderText({ node }) {
    return `{{${readAttributes(node.attrs).key}}}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(TemplateVariableNodeView, { as: 'span' })
  },

  addProseMirrorPlugins() {
    const registry = this.options.registry
    return [
      Suggestion<PromptSuggestionItem, PromptSuggestionItem>({
        editor: this.editor,
        pluginKey: templateVariableSuggestionKey,
        char: '/',
        container: registry.getSuggestionContainer(),
        items: async ({ query }) => (
          (await registry.getVariableSuggestions(query)).map((value) => ({
            kind: 'variable' as const,
            value,
          }))
        ),
        command: ({ editor, range, props }): void => {
          if (props.kind === 'variable') insertTemplateVariable(editor, range, props.value)
        },
        render: createSuggestionRenderer(),
      }),
    ]
  },
})
