/** r186 的私有时钟访问集中在这里；升级 three 必须重新核对 Animation / NodeFrame。 */
interface ThreeClockRenderer {
  _animation: { stop(): void }
  _nodes: { nodeFrame: { time: number; deltaTime: number; frameId: number; update(): void } }
  info: { frame: number }
}

export class VideoEditAuthorThreeClock {
  private readonly renderer: ThreeClockRenderer
  private active = false
  constructor(renderer: unknown, revision: string) {
    const value = renderer as Partial<ThreeClockRenderer>
    if (revision !== '186' || typeof value._animation?.stop !== 'function' ||
      typeof value._nodes?.nodeFrame?.update !== 'function' || !value.info ||
      !['time', 'deltaTime', 'frameId'].every(key => typeof Reflect.get(value._nodes!.nodeFrame, key) === 'number')) {
      throw new Error('受管 three 时钟仅支持已验证的 r186 NodeFrame。')
    }
    this.renderer = value as ThreeClockRenderer
    this.stop()
  }
  stop(): void { this.renderer._animation.stop() }
  async run<T>(sourceSeconds: number, action: () => T | Promise<T>): Promise<T> {
    if (!Number.isFinite(sourceSeconds)) throw new Error('three 源时间必须有限。')
    if (this.active) throw new Error('three 编译与渲染必须由宿主串行调度。')
    this.active = true
    this.stop()
    const { nodeFrame } = this.renderer._nodes
    const ownUpdate = Object.getOwnPropertyDescriptor(nodeFrame, 'update')
    const frameId = nodeFrame.frameId + 1
    const update = (): void => {
      nodeFrame.time = sourceSeconds
      nodeFrame.deltaTime = 0
      nodeFrame.frameId = frameId
      this.renderer.info.frame = frameId
    }
    Object.defineProperty(nodeFrame, 'update', { configurable: true, writable: true, value: update })
    update()
    try { return await action() }
    finally {
      this.stop()
      if (ownUpdate) Object.defineProperty(nodeFrame, 'update', ownUpdate)
      else Reflect.deleteProperty(nodeFrame, 'update')
      this.active = false
    }
  }
}
