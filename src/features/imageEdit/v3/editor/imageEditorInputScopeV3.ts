/** 内容冻结时，宿主返回/重试仍可聚焦，但不能由这些按钮触发编辑快捷键。 */
export function isImageEditorInputBlockedV3(root: Element | null | undefined): boolean {
  return Boolean(root?.closest('[inert],[data-editor-input-disabled="true"]'))
}
