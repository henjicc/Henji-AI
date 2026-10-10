import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadSharp } from '../../image/sharp-loader';
import { decodeTransferFunctionV3 } from '../../../../../src/core/imaging/colorManagement';
import { ContentAddressedResourceStore } from '../resource-store';
import { SharpSourceProvider } from '../source-provider';
import { ImageEditorV3SourceIngestor } from '../source-ingest/source-ingestor';
import { TranscodingTileOutputSink } from './transcoding-output-sink';
import { decodeInterleavedRgbaSourceTileV3 } from '../../../../../src/core/imageEdit/v3/execution/sourceTileDecode';
import { removeTemporaryDirectory } from '../../../../../src/tests/removeTemporaryDirectory';

let directory = '';
beforeEach(async () => { directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-color-source-')); });
afterEach(async () => { await removeTemporaryDirectory(directory); });

it.each(['pq', 'hlg'] as const)('真实 %s AVIF 不沿未经验证的 sRGB 解码进入瓦片、代理或正式导入', async transferFunction => {
  const target = path.join(directory, `${transferFunction}.avif`);
  const sink = new TranscodingTileOutputSink(target, { format: 'avif12', tileSize: 16, quality: 100, effort: 1, inputByteOrder: 'little-endian' });
  const pixels = new Uint8Array(16 * 16 * 8), view = new DataView(pixels.buffer);
  for (let pixel = 0; pixel < 256; pixel++) {
    for (let channel = 0; channel < 3; channel++) view.setUint16(pixel * 8 + channel * 2, 39321, true);
    view.setUint16(pixel * 8 + 6, 65535, true);
  }
  await sink.begin({ width: 16, height: 16, channels: 4, bitDepth: 16, sampleFormat: 'uint', colorSpace: 'rec2020', transferFunction,
    alphaMode: 'straight', cicp: { colorPrimaries: 9, transferCharacteristics: transferFunction === 'pq' ? 16 : 18, matrixCoefficients: 9, fullRange: false },
    hdrMetadata: {}, documentId: 'hdr-boundary', revision: 0, sourceFingerprint: 'hdr-boundary' });
  await sink.writeTile({ x: 0, y: 0, width: 16, height: 16, rowStride: 128, pixels }); await sink.complete();
  const resources = new ContentAddressedResourceStore(path.join(directory, 'resources'));
  const resource = await resources.putBuffer(await fsp.readFile(target), { mediaType: 'image/avif' });
  for (const derivedCache of [null, undefined]) {
    const provider = new SharpSourceProvider(resources, { derivedCache });
    expect(await provider.readMetadata(resource.id)).toMatchObject({ hdr: true, cicp: { colorPrimaries: 9 } });
    await expect(provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0, bitDepth: 32 })).rejects.toThrow('颜色保真验证');
    await expect(provider.readFastProxy(resource.id, 64)).rejects.toThrow('颜色保真验证');
    await expect(new ImageEditorV3SourceIngestor(resources, provider).ingest({ kind: 'local-path', filePath: target })).rejects.toThrow('颜色保真验证');
  }
});


it.each([1, 513])('标准 P3 %s×%s 原色与透明度经正式解码/条带/缓存读回，不裁切宽色域', async size => {
  const target = path.join(directory, 'p3.png');
  const pixels = new Uint8Array(size * size * 8), view = new DataView(pixels.buffer);
  for (let pixel = 0; pixel < size * size; pixel++) [65535, 0, 0, 32768].forEach((value, index) => view.setUint16(pixel * 8 + index * 2, value, true));
  const sink = new TranscodingTileOutputSink(target, { format: 'png16', inputByteOrder: 'little-endian' });
  await sink.begin({ width: size, height: size, channels: 4, bitDepth: 16, sampleFormat: 'uint', colorSpace: 'display-p3', transferFunction: 'srgb',
    alphaMode: 'straight', documentId: 'p3-boundary', revision: 0, sourceFingerprint: 'p3-boundary' });
  for (let y = 0; y < size; y += 512) for (let x = 0; x < size; x += 512) {
    const width = Math.min(512, size - x), height = Math.min(512, size - y), tile = new Uint8Array(width * height * 8);
    for (let row = 0; row < height; row++) tile.set(pixels.subarray(((y + row) * size + x) * 8, ((y + row) * size + x + width) * 8), row * width * 8);
    await sink.writeTile({ x, y, width, height, rowStride: width * 8, pixels: tile });
  }
  await sink.complete();
  const resources = new ContentAddressedResourceStore(path.join(directory, 'resources'));
  const resource = await resources.putBuffer(await fsp.readFile(target), { mediaType: 'image/png' });
  for (const derivedCache of [null, undefined]) {
    const provider = new SharpSourceProvider(resources, { derivedCache });
    expect(await provider.readMetadata(resource.id)).toMatchObject({ bitsPerSample: 16, colorSpace: 'display-p3', hasIccProfile: true });
    for (const bitDepth of [8, 16, 32] as const) {
      const tile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0, bitDepth });
      expect(tile).toMatchObject({ bitDepth, colorSpace: bitDepth === 32 ? 'scrgb' : 'srgb', transferFunction: bitDepth === 32 ? 'linear' : 'srgb' });
      expect(tile.pixels.byteLength).toBe(tile.width * tile.height * 4 * bitDepth / 8);
      const values = new DataView(tile.pixels.buffer, tile.pixels.byteOffset, tile.pixels.byteLength);
      if (bitDepth !== 32) {
        // Explicit display/picking requests are bounded sRGB; authoritative reads use Float32.
        const maximum = bitDepth === 8 ? 255 : 65535;
        const read = (channel: number) => bitDepth === 8 ? values.getUint8(channel) : values.getUint16(channel * 2, true);
        expect(read(0)).toBe(maximum); expect(read(1)).toBe(0); expect(read(2)).toBe(0);
        expect(read(3) / maximum).toBeCloseTo(.5, bitDepth === 8 ? 2 : 4);
        continue;
      }
      expect(values.getFloat32(0, true)).toBeGreaterThan(1.2);
      expect(values.getFloat32(4, true)).toBeLessThan(-.04);
      const p3 = decodeInterleavedRgbaSourceTileV3({ ...tile, colorSpace: 'srgb' }, 'display-p3').data;
      expect(p3[0] / p3[3]).toBeCloseTo(1, 6);
      expect(p3[1]).toBeCloseTo(0, 6);
      expect(p3[2]).toBeCloseTo(0, 6);
      expect(p3[3]).toBeCloseTo(32768 / 65535, 6);
    }
    if (size > 512) {
      const neighbor = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 1, tileY: 0, bitDepth: 32 });
      expect(neighbor.width).toBe(1);
      expect(new DataView(neighbor.pixels.buffer, neighbor.pixels.byteOffset).getFloat32(0, true)).toBeGreaterThan(1.2);
    }
    await expect(provider.readFastProxy(resource.id, 64)).resolves.toMatchObject({ format: 'webp', width: Math.min(size, 64), height: Math.min(size, 64) });
  }
});


it('带 sRGB ICC 的 16 位源经 Float32 读取仍有正确颜色和 alpha，不被 ICC 浮点输出归零', async () => {
  const sharp = await loadSharp(), target = path.join(directory, 'srgb-icc.png');
  await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 150, g: 40, b: 20, alpha: .5 } } })
    .toColourspace('rgb16').withIccProfile('srgb').png().toFile(target);
  const encoded = await sharp(target).keepIccProfile().toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer();
  const resources = new ContentAddressedResourceStore(path.join(directory, 'resources'));
  const resource = await resources.putBuffer(await fsp.readFile(target), { mediaType: 'image/png' });
  for (const derivedCache of [null, undefined]) {
    const provider = new SharpSourceProvider(resources, { derivedCache });
    const tile = await provider.readTile({ resourceId: resource.id, mip: 0, tileX: 0, tileY: 0, bitDepth: 32 });
    const values = new DataView(tile.pixels.buffer, tile.pixels.byteOffset);
    for (let channel = 0; channel < 3; channel++) expect(values.getFloat32(channel * 4, true)).toBeCloseTo(decodeTransferFunctionV3(encoded.readUInt16LE(channel * 2) / 65535, 'srgb'), 4);
    expect(values.getFloat32(12, true)).toBeCloseTo(encoded.readUInt16LE(6) / 65535, 6);
  }
});
