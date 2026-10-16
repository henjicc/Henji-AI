import type { VideoEditComposition } from '@/core/videoEdit/document'

/** Bounded samples cover changing titles/glyphs without replaying or moving a playhead.
 * This is speculative work, not a new acceptance limit on authored content. */
export function videoEditContentWarmFrames(document: VideoEditComposition): number[] {
  const frames = new Set<number>()
  for (const clip of document.clips) {
    if (clip.kind !== 'code' && !clip.effects?.some(effect => effect.code)) continue
    const count = Math.min(32, clip.duration)
    for (let i = 0; i < count && frames.size < 96; i++) frames.add(clip.start + Math.round(i * (clip.duration - 1) / Math.max(1, count - 1)))
  }
  return [...frames].sort((a, b) => a - b)
}

/** Each unit yields to real render requests. A new document invalidates the old
 * token synchronously, including preparation already awaiting a compiler/GPU. */
export class VideoEditContentWarmup {
  private generation = 0
  private timer?: ReturnType<typeof setTimeout>
  private frames: number[] = []
  private document?: VideoEditComposition
  constructor(
    private readonly enqueue: (work: () => Promise<void>) => void,
    private readonly prepare: (frame: number, current: () => boolean) => Promise<void>,
    private readonly completed: (document: VideoEditComposition, error?: unknown) => void,
  ) {}
  replace(document: VideoEditComposition): void {
    this.cancel(); this.document = document; this.frames = videoEditContentWarmFrames(document)
    this.defer()
  }
  defer(): void {
    clearTimeout(this.timer)
    if (!this.frames.length) return
    const generation = this.generation
    this.timer = setTimeout(() => {
      this.enqueue(async () => {
        if (generation !== this.generation) return
        const frame = this.frames.shift()
        if (frame === undefined) return
        try {
          await this.prepare(frame, () => generation === this.generation)
          if (generation !== this.generation) return
          if (this.frames.length) this.defer()
          else if (this.document) this.completed(this.document)
        } catch (error) {
          if (generation === this.generation) { this.frames = []; if (this.document) this.completed(this.document, error) }
        }
      })
    }, 40)
  }
  cancel(): void { this.generation++; clearTimeout(this.timer); this.frames = []; this.document = undefined }
}
