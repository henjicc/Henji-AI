/* global sampleRate */
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
    this.fadeFrames = Math.max(1, Math.round(sampleRate * 0.005))
    this.gain = 0
    this.pending = null
    this.grains = []
    this.nextGrain = null
    this.port.onmessage = (event) => {
      const message = event.data
      if (message.type === 'reset') {
        // 旧队列继续淡出；新代次独立接收，连续跳转只保留最后一次目标。
        this.generation = message.generation
        this.pending = { queue: [], queuedFrames: 0 }
        this.stopScrub()
        if (this.gain === 0) this.activatePending()
      } else if (message.type === 'playing') {
        this.playing = message.value
        if (this.playing) this.stopScrub()
      } else if (message.type === 'scrub-stop') {
        this.stopScrub()
      } else if (message.type === 'scrub' && message.generation === this.generation && !this.playing) {
        this.nextGrain = { pcm: new Float32Array(message.pcm), channels: message.channels, offset: 0, gain: 0, stopping: false }
      } else if (message.type === 'chunk' && message.generation === this.generation) {
        const target = this.pending ?? this
        target.queue.push({ pcm: new Float32Array(message.pcm), channels: message.channels, sourceStartFrame: message.sourceStartFrame, frameOffset: 0 })
        target.queuedFrames += message.frameCount
        if (!this.pending) { this.starved = false; this.requestedData = false }
      }
    }
  }

  stopScrub() {
    this.nextGrain = null
    for (const grain of this.grains) grain.stopping = true
  }

  activatePending() {
    this.queue = this.pending.queue
    this.queuedFrames = this.pending.queuedFrames
    this.pending = null
    this.gain = 0
    this.starved = this.queue.length === 0
    this.framesSincePosition = 0
    this.requestedData = false
    this.consumedFrames = 0
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output?.length) return true
    let finalSourceFrame = null
    for (let index = 0; index < output[0].length; index += 1) {
      if (this.pending && this.gain === 0) { this.activatePending(); finalSourceFrame = null }
      // 擦洗最多保留两段，线性交叉淡化的权重和不超过 1，相关信号也不会叠高。
      if (this.nextGrain && this.grains.length < 2) {
        for (const grain of this.grains) grain.stopping = true
        this.grains.push(this.nextGrain)
        this.nextGrain = null
      }
      let scrubGain = 0
      for (const grain of this.grains) {
        const remaining = grain.pcm.length / grain.channels - grain.offset
        const target = grain.stopping ? 0 : Math.min(1, Math.max(0, (remaining - 1) / this.fadeFrames))
        grain.gain += Math.max(-1 / this.fadeFrames, Math.min(1 / this.fadeFrames, target - grain.gain))
        scrubGain += grain.gain
      }
      const target = this.playing && !this.pending ? Math.min(1, Math.max(0, (this.queuedFrames - 1) / this.fadeFrames)) : 0
      this.gain += Math.max(-1 / this.fadeFrames, Math.min(1 / this.fadeFrames, target - this.gain))
      const chunk = (this.playing || this.gain > 0 || this.pending) ? this.queue[0] : null
      for (let channel = 0; channel < output.length; channel += 1) {
        let value = 0
        for (const grain of this.grains) value += (grain.pcm[grain.offset * grain.channels + Math.min(channel, grain.channels - 1)] ?? 0) * grain.gain
        if (chunk) value += chunk.pcm[chunk.frameOffset * chunk.channels + Math.min(channel, chunk.channels - 1)] * Math.min(this.gain, Math.max(0, 1 - scrubGain))
        output[channel][index] = value
      }
      for (let grainIndex = this.grains.length - 1; grainIndex >= 0; grainIndex -= 1) {
        const grain = this.grains[grainIndex]
        grain.offset += 1
        if (grain.gain === 0 || grain.offset >= grain.pcm.length / grain.channels) this.grains.splice(grainIndex, 1)
      }
      if (chunk) {
        chunk.frameOffset += 1
        this.queuedFrames -= 1
        if (!this.pending) {
          this.consumedFrames += 1
          this.framesSincePosition += 1
          finalSourceFrame = chunk.sourceStartFrame + chunk.frameOffset
        }
        if (chunk.frameOffset >= chunk.pcm.length / chunk.channels) this.queue.shift()
      }
    }
    if (finalSourceFrame !== null && (this.framesSincePosition >= sampleRate / 30 || this.queue.length === 0 || !this.playing)) {
      this.framesSincePosition = 0
      this.port.postMessage({ type: 'position', generation: this.generation, sourceFrame: finalSourceFrame, consumedFrames: this.consumedFrames })
    }
    if (!this.pending && this.playing) {
      if (this.queue.length === 0 && !this.starved) {
        this.starved = true
        this.port.postMessage({ type: 'starved', generation: this.generation, consumedFrames: this.consumedFrames })
      } else if (this.queuedFrames < sampleRate * 1.5 && !this.requestedData) {
        this.requestedData = true
        this.port.postMessage({ type: 'need-data', generation: this.generation, consumedFrames: this.consumedFrames })
      }
    }
    return true
  }
}

registerProcessor('henji-audio-edit-preview', HenjiAudioEditPreviewProcessor)
