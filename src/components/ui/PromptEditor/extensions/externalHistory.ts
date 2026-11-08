import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import { Step, StepMap, StepResult } from '@tiptap/pm/transform'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 编辑器以外的一次状态变化（如参考素材增删）：撤销时执行 undo，重做时执行 redo。 */
export interface PromptEditorExternalChange {
  undo: () => void
  redo: () => void
}

const RECORD_META = 'promptEditorExternalRecord'

/**
 * 不改文档的步骤，只把一次外部变化带进 ProseMirror 的撤销栈：文字编辑与外部变化按发生顺序排在同一条历史里，
 * 和文字插入放进同一个事务时两者一起撤销。epoch 是编辑器被整份替换内容时的代次，替换前记下的步骤失效，
 * 免得撤销把已经被替换掉的旧状态翻出来。
 */
class ExternalChangeStep extends Step {
  constructor(readonly run: () => void, readonly reverse: () => void, readonly epoch: number) {
    super()
  }

  apply(doc: ProseMirrorNode): StepResult {
    return StepResult.ok(doc)
  }

  invert(): Step {
    return new ExternalChangeStep(this.reverse, this.run, this.epoch)
  }

  getMap(): StepMap {
    return StepMap.empty
  }

  map(): Step {
    return this
  }

  // 只存在于内存撤销栈，不登记 jsonID、不参与序列化
  toJSON(): { stepType: string } {
    return { stepType: 'promptEditorExternalChange' }
  }
}

interface ExternalHistoryStorage {
  epoch: number
}

/** 往事务里加入一次外部变化；变化本身已经发生，这里只登记撤销与重做。单独成一步，不与前后打字合并。 */
export function addExternalChange(tr: Transaction, change: PromptEditorExternalChange, epoch: number): Transaction {
  closeHistory(tr)
  return tr.step(new ExternalChangeStep(change.redo, change.undo, epoch)).setMeta(RECORD_META, true)
}

export const ExternalHistoryExtension = Extension.create<Record<string, never>, ExternalHistoryStorage>({
  name: 'externalHistory',

  addStorage() {
    return { epoch: 0 }
  },

  onTransaction({ transaction }) {
    // 登记时变化已经发生；只有撤销、重做重放这些步骤时才执行
    if (transaction.getMeta(RECORD_META)) return
    for (const step of transaction.steps) {
      if (step instanceof ExternalChangeStep && step.epoch === this.storage.epoch) step.run()
    }
  },
})
