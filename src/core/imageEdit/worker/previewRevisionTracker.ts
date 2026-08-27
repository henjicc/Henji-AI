/**
 * 预览 revision 只能在同一个编辑会话内比较。
 *
 * Worker 会跨多个图片编辑器实例复用；如果只保存一个全局最大 revision，新编辑器从 1
 * 重新计数时会被旧编辑器留下的数字永久压住。这里同时按 scope 隔离，并在该 scope
 * 没有待处理预览后释放记录，避免会话反复打开造成常驻 Map 增长。
 */
export class PreviewRevisionTracker {
  private readonly latestByScope = new Map<string, number>()
  private readonly activeByScope = new Map<string, number>()

  register(scopeId: string, revision: number): void {
    const latest = this.latestByScope.get(scopeId) ?? -1
    this.latestByScope.set(scopeId, Math.max(latest, revision))
    this.activeByScope.set(scopeId, (this.activeByScope.get(scopeId) ?? 0) + 1)
  }

  isStale(scopeId: string, revision: number): boolean {
    const latest = this.latestByScope.get(scopeId)
    return latest !== undefined && revision < latest
  }

  complete(scopeId: string): void {
    const active = this.activeByScope.get(scopeId)
    if (active === undefined) return
    if (active > 1) {
      this.activeByScope.set(scopeId, active - 1)
      return
    }
    this.activeByScope.delete(scopeId)
    this.latestByScope.delete(scopeId)
  }

  clear(): void {
    this.activeByScope.clear()
    this.latestByScope.clear()
  }
}
