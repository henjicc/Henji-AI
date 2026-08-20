import { describe, expect, it } from 'vitest';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import {
  applyPngDpi,
  validateBlankImageSpec,
} from './blankImage';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function decodePng(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(',')[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function readPhysicalChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'pHYs') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

describe('空白图片', () => {
  it('校验尺寸、总像素、DPI 和背景色', () => {
    expect(validateBlankImageSpec({ width: 1920, height: 1080, dpi: 72, backgroundColor: WHITE_HEX })).toBeNull();
    expect(validateBlankImageSpec({ width: 9000, height: 1080, dpi: 72, backgroundColor: WHITE_HEX })).toContain('8192');
    expect(validateBlankImageSpec({ width: 8192, height: 8192, dpi: 72, backgroundColor: WHITE_HEX })).toContain('4000 万');
    expect(validateBlankImageSpec({ width: 1920, height: 1080, dpi: 0, backgroundColor: WHITE_HEX })).toContain('DPI');
  });

  it('写入并替换唯一的 PNG pHYs 密度块', () => {
    const first = applyPngDpi(ONE_PIXEL_PNG, 72);
    const second = applyPngDpi(first, 300);
    const chunks = readPhysicalChunks(decodePng(second));
    expect(chunks).toHaveLength(1);
    expect(readUint32(chunks[0], 0)).toBe(Math.round(300 / 0.0254));
    expect(readUint32(chunks[0], 4)).toBe(Math.round(300 / 0.0254));
    expect(chunks[0][8]).toBe(1);
  });
});
