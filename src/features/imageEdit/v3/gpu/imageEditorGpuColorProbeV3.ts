import { draw, frame, target, type Gpu } from 'vgpu'

import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import {
  imageEditorGpuPresentColorUniformV3,
  packImageEditorGpuColorMatrixRowsV3,
} from './imageEditorGpuColorPipelineV3'
import { float32ToFloat16 } from './imageEditorGpuTileAtlasV3'
import presentShaderSource from './shaders/imageEditorGpuRasterPresentV3.wgsl?raw'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40

/** 仅供 golden/诊断读回；正式实时帧仍禁止 GPU→CPU readback。 */
export async function renderImageEditorGpuSdrColorProbeV3(
  gpu: Gpu,
  linearPremultiplied: Float32Array,
  width: number,
  height: number,
  color: ImageEditColorModeV3,
): Promise<Float32Array> {
  if (linearPremultiplied.length !== width * height * 4) throw new Error('GPU 色彩探针像素长度不一致')
  const source = gpu.device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: ['copy_dst', 'texture_binding'],
    label: 'image-editor-gpu-color-probe-source',
  })
  const encoded = new Uint16Array(linearPremultiplied.length)
  for (let index = 0; index < encoded.length; index += 1) {
    encoded[index] = float32ToFloat16(linearPremultiplied[index])
  }
  gpu.gpu.queue.writeTexture(
    { texture: source.gpu },
    encoded,
    { bytesPerRow: width * 8, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  )
  const output = target(gpu, {
    size: [width, height],
    format: 'rgba8unorm',
    clearColor: [0, 0, 0, 0],
    label: 'image-editor-gpu-color-probe-output',
  })
  const present = draw(gpu, {
    shader: presentShaderSource,
    vertices: 3,
    label: 'image-editor-gpu-color-probe-present',
  })
  const uniform = gpu.gpu.createBuffer({
    size: 64,
    usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
    label: 'image-editor-gpu-color-probe-uniform',
  })
  try {
    await present.compile(output)
    const values = imageEditorGpuPresentColorUniformV3(color)
    gpu.gpu.queue.writeBuffer(uniform, 0, new Float32Array([
      ...packImageEditorGpuColorMatrixRowsV3(values.workingToSrgb),
      values.toneMapToSdr ? 1 : 0, 0, 0, 0,
    ]))
    present.group(0, gpu.gpu.createBindGroup({
      layout: present.layout(0),
      entries: [
        { binding: 0, resource: source.view },
        { binding: 1, resource: { buffer: uniform } },
      ],
    }))
    const submitted = frame(gpu, (currentFrame) => currentFrame.pass({
      target: output,
      clear: [0, 0, 0, 0],
    }, present))
    await submitted.done
    await gpu.settled()
    return await output.readFloats()
  } finally {
    uniform.destroy()
    source.destroy()
    output.color.destroy()
  }
}
