/** Mixed sound is requested in blocks of this length. */
export const VIDEO_EDIT_AUDIO_BLOCK_SECONDS = 0.5
/** A block is requested once the playback clock is this close to its start. */
export const VIDEO_EDIT_AUDIO_LOOKAHEAD_SECONDS = 0.4

/** One pump of the scheduler: where the clock is and how to get and place the next block. */
export interface VideoEditAudioPump {
  context: BaseAudioContext
  destination: AudioNode
  /** Context time at which timeline second 0 would sound (the playback clock origin on the audio clock). */
  origin: number
  /** Current playback position (timeline seconds). */
  timelineTime: number
  /** No sound is requested at or after this time. */
  endTime: number
  mix(from: number, duration: number): Promise<AudioBuffer>
  /** Whether a finished block still belongs to the playback that requested it. */
  isCurrent(): boolean
  onError(error: unknown): void
}

/**
 * Forward playback sound shared by the program and source monitors: mixed blocks are requested just ahead of the
 * playback clock, one at a time, and placed on the audio clock at `origin + from`; a block that arrives late starts
 * part-way in so it stays in sync with the picture. `stop()` silences every placed block and discards blocks still
 * being mixed.
 */
export class VideoEditAudioScheduler {
  private readonly nodes = new Set<AudioBufferSourceNode>()
  private generation = 0
  private pending = false
  private next = 0

  /** Starts a run at timeline second `from` (the next block requested). */
  start(from: number): void { this.next = from }

  pump(request: VideoEditAudioPump): void {
    if (this.pending || this.next >= request.timelineTime + VIDEO_EDIT_AUDIO_LOOKAHEAD_SECONDS || this.next >= request.endTime) return
    const duration = Math.min(VIDEO_EDIT_AUDIO_BLOCK_SECONDS, request.endTime - this.next)
    const from = this.next; this.next += duration; this.pending = true
    const generation = this.generation
    const { context } = request
    void request.mix(from, duration).then(buffer => {
      if (generation !== this.generation || !request.isCurrent()) return
      const node = context.createBufferSource(); node.buffer = buffer; node.connect(request.destination)
      const when = request.origin + from
      const offset = Math.max(0, context.currentTime - when)
      if (offset < buffer.duration) { node.start(Math.max(when, context.currentTime), offset); this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect() } }
      else node.disconnect()
    }).catch(error => { if (generation === this.generation && request.isCurrent()) request.onError(error) }).finally(() => { this.pending = false })
  }

  stop(): void {
    this.generation++
    for (const node of this.nodes) { try { node.stop() } catch { /* already ended */ } node.disconnect() }
    this.nodes.clear()
  }
}
