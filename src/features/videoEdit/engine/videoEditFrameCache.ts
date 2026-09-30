export interface CachedVideoEditFrame {
  close(): void
  allocationSize(): number
  format?: string | null
  codedWidth?: number
  codedHeight?: number
  timestamp: number
  duration: number
}

/** One preview working set shared by original paths, never persisted to disk. */
export class VideoEditFrameCache {
  private readonly entries = new Map<string, { mediaId: string; frame: CachedVideoEditFrame; bytes: number }>()
  private used = 0
  private hot: ReadonlyArray<{ mediaId: string; time: number }> = []
  constructor(readonly budgetBytes: number) {}
  get bytes(): number { return this.used }
  setHotFrames(hot: ReadonlyArray<{ mediaId: string; time: number }>): void { this.hot = hot }
  get(mediaId: string, time: number): CachedVideoEditFrame | undefined {
    for (const [key, entry] of this.entries) {
      const { timestamp, duration } = entry.frame
      if (entry.mediaId === mediaId && time >= timestamp - 1e-7 && time < timestamp + duration - 1e-7) {
        this.entries.delete(key); this.entries.set(key, entry)
        return entry.frame
      }
    }
  }
  put(mediaId: string, frame: CachedVideoEditFrame, pinned: ReadonlySet<CachedVideoEditFrame>): void {
    const key = `${mediaId}:${frame.timestamp}`
    const previous = this.entries.get(key)
    if (previous) { frame.close(); return }
    // Opaque hardware frames intentionally hide their plane layout. Account
    // conservatively as RGBA instead of asking allocationSize() to read pixels.
    const bytes = frame.format === null && frame.codedWidth && frame.codedHeight ? frame.codedWidth * frame.codedHeight * 4 : frame.allocationSize()
    if (bytes > this.budgetBytes) { frame.close(); return }
    this.entries.set(key, { mediaId, frame, bytes }); this.used += bytes
    for (const hotAllowed of [false, true]) for (const [candidate, entry] of this.entries) {
      if (this.used <= this.budgetBytes) break
      if (pinned.has(entry.frame)) continue
      if (!hotAllowed && this.hot.some(hot => hot.mediaId === entry.mediaId && entry.frame.timestamp >= hot.time - 1 && entry.frame.timestamp <= hot.time + 1)) continue
      this.entries.delete(candidate); this.used -= entry.bytes; entry.frame.close()
    }
  }
  deleteMedia(mediaId: string): void {
    for (const [key, entry] of this.entries) if (entry.mediaId === mediaId) {
      this.entries.delete(key); this.used -= entry.bytes; entry.frame.close()
    }
  }
  clear(): void { for (const entry of this.entries.values()) entry.frame.close(); this.entries.clear(); this.used = 0 }
}
