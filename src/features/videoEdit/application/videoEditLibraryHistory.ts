interface LibraryHistory {
  order(redo: boolean): number | undefined
  apply(redo: boolean): void
  clearRedo(): void
}

let sequence = 0
let library: LibraryHistory | undefined
let clearDocumentRedo: (() => void) | undefined
/** 每次新提交（文档或效果库）取一个顺序号；新提交让另一方的重做失效，撤销与重做才是同一条链。 */
export function nextVideoEditHistoryOrder(source: 'document' | 'library'): number {
  if (source === 'document') library?.clearRedo()
  else clearDocumentRedo?.()
  return ++sequence
}
export function registerVideoEditLibraryHistory(history: LibraryHistory): void { library = history }
export function registerVideoEditDocumentRedo(clear: () => void): void { clearDocumentRedo = clear }
export function hasVideoEditLibraryHistory(redo: boolean): boolean { return library?.order(redo) !== undefined }

/** 文档与全局库仍各自拥有状态，撤销命令按真实提交顺序选择同一份领域历史。 */
export function undoVideoEditLibraryBefore(documentOrder: number | undefined, redo: boolean): boolean {
  const order = library?.order(redo)
  if (order === undefined || documentOrder !== undefined && (redo ? order > documentOrder : order < documentOrder)) return false
  library!.apply(redo)
  return true
}
