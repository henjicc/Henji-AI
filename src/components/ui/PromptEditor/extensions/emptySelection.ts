import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

/**
 * 空文档里不留选区：全选空白内容或整份替换成空内容后，选区会框住空段落末尾的换行占位，
 * 浏览器把它画成光标旁一小块淡强调色。空文档没有可选的内容，选区一律收成光标。
 */
export const EmptySelectionExtension = Extension.create({
  name: 'promptEmptySelection',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (_transactions, _oldState, state) => {
        const { doc, selection } = state
        if (selection.empty || doc.childCount !== 1 || doc.firstChild?.content.size !== 0) return null
        return state.tr.setSelection(TextSelection.create(doc, 1))
      },
    })]
  },
})
