const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PNG_PHYS_CHUNK = 'pHYs';

export const BLANK_IMAGE_MIN_EDGE = 16;
export const BLANK_IMAGE_MAX_EDGE = 8192;
export const BLANK_IMAGE_MAX_PIXELS = 40_000_000;
export const BLANK_IMAGE_MIN_DPI = 1;
export const BLANK_IMAGE_MAX_DPI = 1200;

export interface BlankImageSpec {
  width: number;
  height: number;
  dpi: number;
  backgroundColor: string;
}

function decodeBase64(payload: string): Uint8Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPhysicalPixelChunk(dpi: number): Uint8Array {
  const data = new Uint8Array(9);
  const pixelsPerMeter = Math.max(1, Math.round(dpi / 0.0254));
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;

  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set([112, 72, 89, 115], 0);
  typeAndData.set(data, 4);

  const chunk = new Uint8Array(4 + typeAndData.length + 4);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeAndData, 4);
  writeUint32(chunk, chunk.length - 4, crc32(typeAndData));
  return chunk;
}

/** 写入 PNG pHYs 块；已有密度块会被替换，其他块保持原顺序和字节内容。 */
export function applyPngDpi(dataUrl: string, dpi: number): string {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return dataUrl;
  const safeDpi = Math.round(dpi);
  if (!Number.isFinite(safeDpi) || safeDpi < BLANK_IMAGE_MIN_DPI || safeDpi > BLANK_IMAGE_MAX_DPI) {
    throw new Error('DPI 超出允许范围');
  }

  const source = decodeBase64(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
  if (!PNG_SIGNATURE.every((value, index) => source[index] === value)) {
    throw new Error('无效的 PNG 图片');
  }

  const parts: Uint8Array[] = [source.subarray(0, PNG_SIGNATURE.length)];
  let offset: number = PNG_SIGNATURE.length;
  let inserted = false;
  while (offset + 12 <= source.length) {
    const dataLength = readUint32(source, offset);
    const end = offset + 12 + dataLength;
    if (end > source.length) throw new Error('PNG 数据不完整');
    const type = chunkType(source, offset);
    if (type !== PNG_PHYS_CHUNK) {
      parts.push(source.subarray(offset, end));
    }
    if (type === 'IHDR' && !inserted) {
      parts.push(createPhysicalPixelChunk(safeDpi));
      inserted = true;
    }
    offset = end;
    if (type === 'IEND') break;
  }
  if (!inserted) throw new Error('PNG 缺少 IHDR');

  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let outputOffset = 0;
  for (const part of parts) {
    output.set(part, outputOffset);
    outputOffset += part.length;
  }
  return `${PNG_DATA_URL_PREFIX}${encodeBase64(output)}`;
}

export function validateBlankImageSpec(spec: BlankImageSpec): string | null {
  if (!Number.isInteger(spec.width) || !Number.isInteger(spec.height)) return '宽度和高度必须是整数';
  if (
    spec.width < BLANK_IMAGE_MIN_EDGE
    || spec.height < BLANK_IMAGE_MIN_EDGE
    || spec.width > BLANK_IMAGE_MAX_EDGE
    || spec.height > BLANK_IMAGE_MAX_EDGE
  ) {
    return `宽度和高度需在 ${BLANK_IMAGE_MIN_EDGE}–${BLANK_IMAGE_MAX_EDGE} 像素之间`;
  }
  if (spec.width * spec.height > BLANK_IMAGE_MAX_PIXELS) return '图片总像素不能超过 4000 万';
  if (!Number.isInteger(spec.dpi) || spec.dpi < BLANK_IMAGE_MIN_DPI || spec.dpi > BLANK_IMAGE_MAX_DPI) {
    return `DPI 需在 ${BLANK_IMAGE_MIN_DPI}–${BLANK_IMAGE_MAX_DPI} 之间`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(spec.backgroundColor)) return '请选择有效的背景色';
  return null;
}

export function createBlankImageDataUrl(spec: BlankImageSpec): string {
  const validationError = validateBlankImageSpec(spec);
  if (validationError) throw new Error(validationError);

  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建空白图片画布');
  context.fillStyle = spec.backgroundColor;
  context.fillRect(0, 0, spec.width, spec.height);
  return applyPngDpi(canvas.toDataURL('image/png'), spec.dpi);
}
