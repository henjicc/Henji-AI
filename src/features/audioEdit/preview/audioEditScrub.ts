export interface AudioEditScrubControls {
  start: (frame: number) => void
  move: (frame: number) => void
  end: () => void
  step: (frame: number) => void
}

// 只连接当前预览实例与编辑器的瞬时手势，不新增业务状态或另一份播放引擎。
const controls = new Map<string, AudioEditScrubControls>()
export function bindAudioEditScrub(projectId: string, value: AudioEditScrubControls): () => void {
  controls.set(projectId, value)
  return () => { if (controls.get(projectId) === value) controls.delete(projectId) }
}
export function audioEditScrub(projectId: string): AudioEditScrubControls | undefined { return controls.get(projectId) }

/** 单飞读取，40ms 最小起音间隔；等待期间覆盖目标，旧读取完成也不能发声。 */
export function createScrubScheduler<T>(read: (frame: number) => Promise<T>, play: (value: T) => void, failed: (error: unknown) => void) {
  let revision = 0
  let pending: { frame: number; revision: number } | null = null
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPlayed = -Infinity
  let lastFrame: number | undefined
  const pump = () => {
    if (busy || timer !== undefined || !pending) return
    const delay = Math.max(0, lastPlayed + 40 - performance.now())
    if (delay > 0) { timer = setTimeout(() => { timer = undefined; pump() }, delay); return }
    const request = pending
    pending = null
    busy = true
    void read(request.frame).then(value => {
      if (request.revision !== revision) return
      lastPlayed = performance.now()
      play(value)
    }).catch(error => { if (request.revision === revision) failed(error) }).finally(() => { busy = false; pump() })
  }
  return {
    request(frame: number) {
      if (frame === lastFrame) return
      lastFrame = frame
      pending = { frame, revision: ++revision }
      pump()
    },
    cancel() {
      revision += 1
      pending = null
      lastFrame = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
