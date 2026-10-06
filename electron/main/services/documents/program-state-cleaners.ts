/*
 * 按文档 ID 清理程序目录里的内部缓存（4.4 收 3.3 遗留）：文档离开作品（移到回收站、删除空草稿、
 * 从列表移除、所在项目移到回收站）时，底座在清掉通用封面与会话状态之后逐个调用这里登记的清理方式。
 *
 * 各工具在自己的模块初始化处登记（如口播的解码缓存与处理任务回执、镜头参考的渲染回执），
 * 底座不认识具体类型。清理只删可重建的内部数据；单个清理失败只记日志，不影响文档操作本身。
 */

export type DocumentProgramStateCleaner = (docId: string) => Promise<void> | void

const cleaners = new Map<string, DocumentProgramStateCleaner>()

/** 同一 ID 重复登记以最后一次为准（测试重置时不会累积）。 */
export function registerDocumentProgramStateCleaner(id: string, cleaner: DocumentProgramStateCleaner): void {
  cleaners.set(id, cleaner)
}

/** 逐个执行已登记的清理；返回失败的登记 ID 与错误，由调用方记日志。 */
export async function runDocumentProgramStateCleaners(docId: string): Promise<Array<{ id: string; error: unknown }>> {
  const failures: Array<{ id: string; error: unknown }> = []
  for (const [id, cleaner] of cleaners) {
    try {
      await cleaner(docId)
    } catch (error) {
      failures.push({ id, error })
    }
  }
  return failures
}

/** 仅供测试：清空登记。 */
export function resetDocumentProgramStateCleanersForTest(): void {
  cleaners.clear()
}
