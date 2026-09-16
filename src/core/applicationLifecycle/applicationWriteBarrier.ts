let frozen = false

export function assertApplicationWritesAllowed(): void {
  if (frozen) throw new Error('APPLICATION_CLOSING：应用正在保存并关闭，请稍后重试')
}

/** 最后一次保存至窗口确认期间不接纳新的业务修改；关闭失败必须恢复编辑。 */
export function freezeApplicationWrites(): () => void {
  assertApplicationWritesAllowed()
  frozen = true
  let released = false
  return () => { if (!released) { released = true; frozen = false } }
}
