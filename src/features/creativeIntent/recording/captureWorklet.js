/* global currentFrame */
class ExplanationCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = new Float32Array(4096)
    this.used = 0
    this.firstFrame = 0
    this.stopped = false
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.send()
        this.stopped = true
        this.port.postMessage({ stopped: true })
      }
    }
  }
  send() {
    if (!this.used) return
    const samples = this.samples.slice(0, this.used)
    this.port.postMessage({ firstFrame: this.firstFrame, samples }, [samples.buffer])
    this.used = 0
  }
  process(inputs) {
    if (this.stopped) return false
    const input = inputs[0]?.[0]
    if (!input) { this.send(); return true }
    if (this.used && currentFrame !== this.firstFrame + this.used) this.send()
    for (let i = 0; i < input.length; i++) {
      if (!this.used) this.firstFrame = currentFrame + i
      this.samples[this.used++] = input[i]
      if (this.used === this.samples.length) this.send()
    }
    return true
  }
}
registerProcessor('henji-explanation-capture', ExplanationCaptureProcessor)
