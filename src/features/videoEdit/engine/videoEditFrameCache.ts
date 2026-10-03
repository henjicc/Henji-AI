export interface CachedVideoEditFrame {
  close(): void
  allocationSize(): number
  format?: string | null
  codedWidth?: number
  codedHeight?: number
  timestamp: number
  duration: number
}

/**
 * Frames behind the motion are this much cheaper to keep than frames ahead of it: a forward scrub or playback keeps
 * about four seconds ahead for every second behind (task 3.1, 10-bit 4K scrubbing filled the cache with frames
 * already passed and evicted the decoded window it was about to show).
 */
const BEHIND_WEIGHT = 4
/** A hot time moving further than this between two renders is a jump, not a motion. */
const MOTION_JUMP_SECONDS = 2

/**
 * One preview working set shared by original paths, never persisted to disk.
 *
 * Eviction keeps what the next pictures need. Frames of media that is not showing go first (least recently used
 * first); then, for media that is showing, the frame farthest from the pictures being shown (`setHotFrames`), where
 * distance behind the direction the hot times move (playback, scrubbing, reverse) counts `BEHIND_WEIGHT` times more
 * than distance ahead, so prefetched pictures ahead survive while passed ones go.
 */
export class VideoEditFrameCache {
  private readonly entries = new Map<string, { mediaId: string; frame: CachedVideoEditFrame; bytes: number }>()
  private used = 0
  private hot = new Map<string, number[]>()
  /** Per showing media: the mean hot time of the last render and the direction it moved (1, -1, or 0 unknown). */
  private readonly motion = new Map<string, { center: number; direction: number }>()
  constructor(readonly budgetBytes: number) {}
  get bytes(): number { return this.used }
  setHotFrames(hot: ReadonlyArray<{ mediaId: string; time: number }>): void {
    const next = new Map<string, number[]>()
    for (const { mediaId, time } of hot) if (Number.isFinite(time)) next.set(mediaId, [...next.get(mediaId) ?? [], time])
    for (const [mediaId, times] of next) {
      const center = times.reduce((sum, time) => sum + time, 0) / times.length
      const previous = this.motion.get(mediaId)
      const delta = previous ? center - previous.center : 0
      // Standing still keeps the last direction (a paused scrub keeps its prefetched side); a jump forgets it.
      const direction = !previous || Math.abs(delta) > MOTION_JUMP_SECONDS ? 0 : Math.abs(delta) < 1e-6 ? previous.direction : Math.sign(delta)
      this.motion.set(mediaId, { center, direction })
    }
    for (const mediaId of this.motion.keys()) if (!next.has(mediaId)) this.motion.delete(mediaId)
    this.hot = next
  }
  get(mediaId: string, time: number): CachedVideoEditFrame | undefined {
    for (const [key, entry] of this.entries) {
      const { timestamp, duration } = entry.frame
      if (entry.mediaId === mediaId && time >= timestamp - 1e-7 && time < timestamp + duration - 1e-7) {
        this.entries.delete(key); this.entries.set(key, entry)
        return entry.frame
      }
    }
  }
  /** Eviction priority of one entry: higher goes first. Not showing: infinite (ties keep least-recently-used order). */
  private distance(mediaId: string, frame: CachedVideoEditFrame): number {
    const hot = this.hot.get(mediaId)
    if (!hot) return Infinity
    const direction = this.motion.get(mediaId)?.direction ?? 0
    let best = Infinity
    for (const time of hot) {
      // A frame covering the hot time is distance 0; otherwise the gap to its nearest edge.
      const ahead = frame.timestamp - time; const behind = time - (frame.timestamp + frame.duration)
      const gap = ahead > 0 ? (direction < 0 ? ahead * BEHIND_WEIGHT : ahead) : behind > -1e-7 ? (direction > 0 ? Math.max(0, behind) * BEHIND_WEIGHT : Math.max(0, behind)) : 0
      if (gap < best) best = gap
    }
    return best
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
    while (this.used > this.budgetBytes) {
      let victim: string | undefined; let worst = -1
      // Map order is least recently used first, so a strict comparison keeps that order among equal distances.
      for (const [candidate, entry] of this.entries) {
        if (pinned.has(entry.frame)) continue
        const distance = this.distance(entry.mediaId, entry.frame)
        if (distance > worst) { worst = distance; victim = candidate; if (distance === Infinity) break }
      }
      if (victim === undefined) break
      const entry = this.entries.get(victim)!
      this.entries.delete(victim); this.used -= entry.bytes; entry.frame.close()
    }
  }
  deleteMedia(mediaId: string): void {
    for (const [key, entry] of this.entries) if (entry.mediaId === mediaId) {
      this.entries.delete(key); this.used -= entry.bytes; entry.frame.close()
    }
  }
  clear(): void { for (const entry of this.entries.values()) entry.frame.close(); this.entries.clear(); this.used = 0 }
}
