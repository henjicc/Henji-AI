export type ApplicationCloseGuard = () => Promise<void>

const closeGuards = new Set<ApplicationCloseGuard>()

/**
 * 注册窗口关闭前必须完成的渲染层事务。守卫失败会阻止窗口确认关闭，避免静默丢数据。
 */
export function registerApplicationCloseGuard(guard: ApplicationCloseGuard): () => void {
  closeGuards.add(guard)
  return () => closeGuards.delete(guard)
}

export async function runApplicationCloseGuards(): Promise<void> {
  for (const guard of [...closeGuards]) await guard()
}
