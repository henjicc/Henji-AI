import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  GPANO_NAMESPACE,
  buildPanoramaXmp,
  createFullPanoramaMetadata,
  embedPanoramaMetadataInImage,
  readPanoramaMetadataFromImage,
} from './panorama-metadata'

const FORMATS = ['png', 'jpeg', 'webp'] as const

async function createImage(format: typeof FORMATS[number], width = 64, height = 32): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 36, g: 88, b: 144, alpha: 0.85 },
    },
  })
  if (format === 'jpeg') return await pipeline.jpeg({ quality: 91 }).toBuffer()
  if (format === 'webp') return await pipeline.webp({ quality: 88 }).toBuffer()
  return await pipeline.png().toBuffer()
}

describe('panorama metadata', () => {
  it.each(FORMATS)('%s 容器无重编码写入并读回完整 GPano', async (format) => {
    const input = await createImage(format)
    const beforePixels = await sharp(input).ensureAlpha().raw().toBuffer()

    const embedded = await embedPanoramaMetadataInImage(input, format)
    const result = await readPanoramaMetadataFromImage(embedded.bytes, format)
    const afterPixels = await sharp(embedded.bytes).ensureAlpha().raw().toBuffer()

    expect(embedded.format).toBe(format)
    expect(result).toEqual({
      format,
      status: 'valid',
      metadata: createFullPanoramaMetadata(64, 32),
    })
    expect(afterPixels.equals(beforePixels)).toBe(true)
    if (format !== 'png') {
      expect((await sharp(embedded.bytes).metadata()).xmpAsString).toContain(GPANO_NAMESPACE)
    }
  })

  it('PNG 和 JPEG 重复写入时替换旧 XMP 而不累积多份', async () => {
    for (const format of ['png', 'jpeg'] as const) {
      const input = await createImage(format)
      const first = await embedPanoramaMetadataInImage(input, format)
      const second = await embedPanoramaMetadataInImage(first.bytes, format)
      expect(second.bytes.toString('utf8').match(/<GPano:ProjectionType>/g)).toHaveLength(1)
    }
  })

  it('普通图片和无关 XMP 不误判为全景', async () => {
    const input = await createImage('png')
    expect(await readPanoramaMetadataFromImage(input, 'png')).toEqual({
      format: 'png',
      status: 'absent',
      metadata: null,
    })

    const unrelated = await sharp(input)
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><note>ordinary image</note></x:xmpmeta>')
      .png()
      .toBuffer()
    expect(await readPanoramaMetadataFromImage(unrelated, 'png')).toEqual({
      format: 'png',
      status: 'absent',
      metadata: null,
    })
  })

  it('缺少必填字段的 GPano XMP 返回 invalid 而不伪造默认值', async () => {
    const input = await createImage('webp')
    const invalidXmp = [
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      `<rdf:Description xmlns:GPano="${GPANO_NAMESPACE}">`,
      '<GPano:ProjectionType>equirectangular</GPano:ProjectionType>',
      '</rdf:Description></rdf:RDF></x:xmpmeta>',
    ].join('')
    const encoded = await sharp(input).withXmp(invalidXmp).webp().toBuffer()

    const result = await readPanoramaMetadataFromImage(encoded, 'webp')

    expect(result.status).toBe('invalid')
    expect(result.metadata).toBeNull()
    expect(result.reason).toContain('UsePanoramaViewer')
  })

  it('非 2:1 图片拒绝写入完整全景语义', async () => {
    const input = await createImage('png', 64, 40)
    await expect(embedPanoramaMetadataInImage(input, 'png')).rejects.toThrow('exact 2:1')
  })

  it('最小 XMP 同时支持元素与属性形式的读取', async () => {
    const metadata = createFullPanoramaMetadata(4000, 2000)
    const elementXmp = buildPanoramaXmp(metadata)
    expect(elementXmp).toContain('<GPano:CroppedAreaTopPixels>0</GPano:CroppedAreaTopPixels>')

    const attributeXmp = [
      `<rdf:Description xmlns:GPano="${GPANO_NAMESPACE}"`,
      'GPano:UsePanoramaViewer="True"',
      'GPano:ProjectionType="equirectangular"',
      'GPano:FullPanoWidthPixels="4000"',
      'GPano:FullPanoHeightPixels="2000"',
      'GPano:CroppedAreaImageWidthPixels="4000"',
      'GPano:CroppedAreaImageHeightPixels="2000"',
      'GPano:CroppedAreaLeftPixels="0"',
      'GPano:CroppedAreaTopPixels="0"/>',
    ].join(' ')
    const input = await createImage('jpeg', 4000, 2000)
    const encoded = await sharp(input).withXmp(attributeXmp).jpeg().toBuffer()
    expect((await readPanoramaMetadataFromImage(encoded, 'jpeg')).metadata).toEqual(metadata)
  })

  it('不支持的格式明确降级为 unsupported', async () => {
    const gif = await sharp({
      create: { width: 64, height: 32, channels: 3, background: 'navy' },
    }).gif().toBuffer()
    expect(await readPanoramaMetadataFromImage(gif, 'gif')).toEqual({
      format: 'unsupported',
      status: 'unsupported',
      metadata: null,
    })
    await expect(embedPanoramaMetadataInImage(gif, 'gif')).rejects.toThrow('does not support')
  })
})
