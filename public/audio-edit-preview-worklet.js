class HenjiAudioEditPreviewProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []
    this.generation = 0
    this.queuedFrames = 0
    this.playing = false
    this.starved = true
    this.framesSincePosition = 0
    this.requestedData = false
    this.consumedFrames = 0
    this.port.onmessage = (event) => {
      const message = event.data
      if (message.type === 'reset') {
        this.generation = message.generation
        this.queue = []
        this.queuedFrames = 0
        this.starved = true
        this.framesSincePosition = 0
        this.requestedData = false
        this.consumedFrames = 0
      } else if (message.type === 'playing') {
        this.playing = message.value
      } else if (message.type === 'chunk' && message.generation === this.generation) {
        this.queue.push({ pcm: new Float32Array(message.pcm), channels: message.channels, sourceStartFrame: message.sourceStartFrame, frameOffset: 0 })
        this.queuedFrames += message.frameCount
        this.starved = false
        this.requestedData = false
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output || !this.playing) return true
    let written = 0
    let finalSourceFrame = null
    while (written < output[0].length && this.queue.length > 0) {
      const chunk = this.queue[0]
      const available = chunk.pcm.length / chunk.channels - chunk.frameOffset
      const take = Math.min(output[0].length - written, available)
      for (let channel = 0; channel < output.length; channel += 1) {
        const sourceChannel = Math.min(channel, chunk.channels - 1)
        for (let index = 0; index < take; index += 1) {
          output[channel][written + index] = chunk.pcm[(chunk.frameOffset + index) * chunk.channels + sourceChannel]
        }
      }
      chunk.frameOffset += take
      written += take
      this.queuedFrames -= take
      this.consumedFrames += take
      finalSourceFrame = chunk.sourceStartFrame + chunk.frameOffset
      if (chunk.frameOffset >= chunk.pcm.length / chunk.channels) this.queue.shift()
    }
    this.framesSincePosition += written
    if (finalSourceFrame !== null && (this.framesSincePosition >= sampleRate / 30 || this.queue.length === 0)) {
      this.framesSincePosition = 0
      this.port.postMessage({ type: 'position', generation: this.generation, sourceFrame: finalSourceFrame, consumedFrames: this.consumedFrames })
    }
    if (this.queue.length === 0 && !this.starved) {
      this.starved = true
      this.port.postMessage({ type: 'starved', generation: this.generation, consumedFrames: this.consumedFrames })
    } else if (this.queuedFrames < sampleRate * 1.5 && !this.requestedData) {
      this.requestedData = true
      this.port.postMessage({ type: 'need-data', generation: this.generation, consumedFrames: this.consumedFrames })
    }
    return true
  }
}

registerProcessor('henji-audio-edit-preview', HenjiAudioEditPreviewProcessor)
