/** 正式剪辑算法给出的拒绝事实；应用域原样投影，界面仍使用 message。 */
export class VideoEditOperationFailure extends Error {
  constructor(message: string, readonly facts: Record<string, unknown>) {
    super(message)
    this.name = 'VideoEditOperationFailure'
  }
}
