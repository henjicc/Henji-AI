/** Correct a driver's under-declared AVC level after encoding, before muxing.
 * The selected level already accounts for coded size, real frame rate and bitrate.
 * AVCDecoderConfigurationRecord and SPS both carry level_idc as a byte; changing
 * it does not recode samples, change profile/constraints, or alter sample timing.
 */
export function videoEditExportAvcLevel(requiredLevel: number): (packet: { data: Uint8Array }, meta?: EncodedVideoChunkMetadata) => void {
  let lengthSize = 4
  const sps = (data: Uint8Array, start: number, end: number): void => {
    if ((data[start] & 31) !== 7) return
    if (end - start < 4) throw new Error('导出 AVC SPS 不完整。')
    data[start + 3] = Math.max(data[start + 3], requiredLevel)
  }
  return (packet, meta) => {
    const config = meta?.decoderConfig
    if (config?.description) {
      const source = config.description
      const data = new Uint8Array(ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : new Uint8Array(source))
      if (data.length < 7 || data[0] !== 1) throw new Error('导出 AVC 配置记录不完整。')
      lengthSize = (data[4] & 3) + 1
      let offset = 6
      for (let i = 0; i < (data[5] & 31); i++) {
        if (offset + 2 > data.length) throw new Error('导出 AVC SPS 长度缺失。')
        const size = data[offset] * 256 + data[offset + 1]
        offset += 2
        if (offset + size > data.length) throw new Error('导出 AVC SPS 超出配置记录。')
        sps(data, offset, offset + size)
        offset += size
      }
      data[3] = Math.max(data[3], requiredLevel)
      config.description = data
      config.codec = `${config.codec.slice(0, -2)}${data[3].toString(16).padStart(2, '0')}`
    }
    // AVC samples normally contain slices only, but an encoder may repeat SPS
    // in-band. Keep those declarations consistent with the configuration record.
    const data = packet.data
    for (let offset = 0; offset < data.length;) {
      if (offset + lengthSize > data.length) throw new Error('导出 AVC 数据包长度缺失。')
      let size = 0
      for (let i = 0; i < lengthSize; i++) size = size * 256 + data[offset++]
      if (size < 1 || offset + size > data.length) throw new Error('导出 AVC 数据包长度无效。')
      sps(data, offset, offset + size)
      offset += size
    }
  }
}
