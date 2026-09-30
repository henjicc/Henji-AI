export interface CachedVideoEditFrame {
  bitmap: ImageBitmap
  timestamp: number
  duration: number
}

/** LRU of decoded preview frames. It never owns project state or original media. */
export class VideoEditFrameCache {
  private readonly entries = new Map<string, { mediaId: string; frame: CachedVideoEditFrame; bytes: number }>()
  private used = 0
  constructor(readonly budgetBytes: number) {}
  get bytes(): number { return this.used }
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
    if (previous) { frame.bitmap.close(); return }
    const bytes = frame.bitmap.width * frame.bitmap.height * 4
    this.entries.set(key, { mediaId, frame, bytes }); this.used += bytes
    for (const [candidate, entry] of this.entries) {
      if (this.used <= this.budgetBytes) break
      if (pinned.has(entry.frame)) continue
      this.entries.delete(candidate); this.used -= entry.bytes; entry.frame.bitmap.close()
    }
  }
  deleteMedia(mediaId: string): void {
    for (const [key, entry] of this.entries) if (entry.mediaId === mediaId) {
      this.entries.delete(key); this.used -= entry.bytes; entry.frame.bitmap.close()
    }
  }
  clear(): void { for (const entry of this.entries.values()) entry.frame.bitmap.close(); this.entries.clear(); this.used = 0 }
}
