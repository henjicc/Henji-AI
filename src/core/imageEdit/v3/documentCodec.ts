import { sanitizeMarkItem } from '../markCodec';
import type { MarkItem } from '../types';
import type {
  ImageEditBitDepthV3,
  ImageEditCicpMetadataV3,
  ImageEditColorModeV3,
  ImageEditHdrMetadataV3,
  ImageEditTransferFunctionV3,
  ImageEditWorkingSpaceV3,
} from './colorTypes';
import {
  IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3,
  createImageEditHdrMetadataV3,
} from './colorTypes';
import {
  IMAGE_EDIT_DOCUMENT_VERSION_V3,
  type ImageEditCanvasGeometryV3,
  type ImageEditCropRectV3,
  type ImageEditDocumentV3,
  type ImageEditOrientationV3,
} from './documentTypes';
import {
  IMAGE_EDIT_BLEND_MODES_V3,
  IMAGE_EDIT_MASK_TILE_SIZE_V3,
  type ImageEditAdjustmentLayerV3,
  type ImageEditAnnotationLayerV3,
  type ImageEditEffectLayerV3,
  type ImageEditGroupLayerV3,
  type ImageEditJsonObjectV3,
  type ImageEditJsonValueV3,
  type ImageEditLayerCommonV3,
  type ImageEditLayerV3,
  type ImageEditMaskReferenceV3,
  type ImageEditRasterLayerV3,
  type ImageEditTransformV3,
} from './layerTypes';
import { isImageEditTransformInvertibleV3 } from './execution/affineTransform';

export type ImageEditDocumentSourceFormatV3 = 'v3' | 'invalid' | 'unknown-version';

export interface ImageEditDocumentDecodeResultV3 {
  document: ImageEditDocumentV3 | null;
  sourceFormat: ImageEditDocumentSourceFormatV3;
  issues: string[];
}

export class InvalidImageEditDocumentV3Error extends Error {}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WORKING_SPACES = new Set<ImageEditWorkingSpaceV3>(['srgb', 'display-p3', 'rec2020']);
const BIT_DEPTHS = new Set<ImageEditBitDepthV3>([8, 16, 'float16', 'float32']);
const TRANSFER_FUNCTIONS = new Set<ImageEditTransferFunctionV3>(['srgb', 'linear', 'pq', 'hlg']);
const ROTATIONS = new Set([0, 90, 180, 270]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseInput(value: unknown): { value: unknown; issue?: string } {
  if (typeof value !== 'string') return { value };
  try {
    return { value: JSON.parse(value) as unknown };
  } catch {
    return { value: null, issue: 'invalid-json' };
  }
}

function cloneJsonValue(value: unknown, depth = 0): ImageEditJsonValueV3 | null | undefined {
  if (depth > 64) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: ImageEditJsonValueV3[] = [];
    for (const entry of value) {
      const cloned = cloneJsonValue(entry, depth + 1);
      if (cloned === undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: ImageEditJsonObjectV3 = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) return undefined;
    const cloned = cloneJsonValue(entry, depth + 1);
    if (cloned === undefined) return undefined;
    result[key] = cloned;
  }
  return result;
}

export function cloneImageEditJsonObjectV3(value: unknown): ImageEditJsonObjectV3 | null {
  const cloned = cloneJsonValue(value);
  return cloned && !Array.isArray(cloned) && typeof cloned === 'object'
    ? cloned as ImageEditJsonObjectV3
    : null;
}

function parseCicp(value: unknown): ImageEditCicpMetadataV3 | undefined {
  if (!isRecord(value)) return undefined;
  const integers = [value.colorPrimaries, value.transferCharacteristics, value.matrixCoefficients];
  if (!integers.every((entry) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255)) {
    return undefined;
  }
  if (typeof value.fullRange !== 'boolean') return undefined;
  return {
    colorPrimaries: Number(value.colorPrimaries),
    transferCharacteristics: Number(value.transferCharacteristics),
    matrixCoefficients: Number(value.matrixCoefficients),
    fullRange: value.fullRange,
  };
}

function readOptionalNonNegative(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function readChromaticity(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
  return { x: value.x, y: value.y };
}

function readContentLight(value: unknown): ImageEditHdrMetadataV3['contentLight'] | null {
  if (!isRecord(value)) return null;
  const maxContent = value.maxContentLightLevelNits;
  const maxFrameAverage = value.maxFrameAverageLightLevelNits;
  if (!isSafeInteger(maxContent) || maxContent < 0 || maxContent > 65_535
    || !isSafeInteger(maxFrameAverage) || maxFrameAverage < 0 || maxFrameAverage > 65_535
    || maxFrameAverage > maxContent) return null;
  return {
    maxContentLightLevelNits: maxContent,
    maxFrameAverageLightLevelNits: maxFrameAverage,
  };
}

function readMasteringDisplay(value: unknown): ImageEditHdrMetadataV3['masteringDisplay'] | null {
  if (!isRecord(value)) return null;
  const red = readChromaticity(value.red);
  const green = readChromaticity(value.green);
  const blue = readChromaticity(value.blue);
  const whitePoint = readChromaticity(value.whitePoint);
  if (!red || !green || !blue || !whitePoint
    || !isFiniteNumber(value.maxLuminanceNits) || value.maxLuminanceNits <= 0
    || value.maxLuminanceNits > 10_000
    || !isFiniteNumber(value.minLuminanceNits) || value.minLuminanceNits < 0
    || value.minLuminanceNits > value.maxLuminanceNits) return null;
  return {
    red,
    green,
    blue,
    whitePoint,
    maxLuminanceNits: value.maxLuminanceNits,
    minLuminanceNits: value.minLuminanceNits,
  };
}

function parseHdrMetadata(value: unknown): ImageEditHdrMetadataV3 | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || (value.standard !== 'pq' && value.standard !== 'hlg')) return undefined;
  const base = createImageEditHdrMetadataV3(value.standard);
  const referenceWhiteNits = value.referenceWhiteNits === undefined
    ? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3
    : value.referenceWhiteNits;
  if (!isFiniteNumber(referenceWhiteNits) || referenceWhiteNits <= 0 || referenceWhiteNits > 10_000) {
    return undefined;
  }
  const cicp = value.cicp === undefined ? base.cicp : parseCicp(value.cicp);
  if (!cicp
    || cicp.colorPrimaries !== 9
    || cicp.transferCharacteristics !== base.cicp.transferCharacteristics
    || cicp.matrixCoefficients !== 9) return undefined;

  let contentLight: ImageEditHdrMetadataV3['contentLight'];
  if (value.contentLight !== undefined) {
    const parsed = readContentLight(value.contentLight);
    if (!parsed) return undefined;
    contentLight = parsed;
  } else {
    const legacyMaxContent = readOptionalNonNegative(value.maxContentLightLevelNits);
    const legacyMaxFrameAverage = readOptionalNonNegative(value.maxFrameAverageLightLevelNits);
    if (legacyMaxContent === null || legacyMaxFrameAverage === null) return undefined;
    if (legacyMaxContent !== undefined && legacyMaxFrameAverage !== undefined) {
      const parsed = readContentLight({
        maxContentLightLevelNits: legacyMaxContent,
        maxFrameAverageLightLevelNits: legacyMaxFrameAverage,
      });
      if (!parsed) return undefined;
      contentLight = parsed;
    }
  }

  let masteringDisplay: ImageEditHdrMetadataV3['masteringDisplay'];
  if (value.masteringDisplay !== undefined) {
    const parsed = readMasteringDisplay(value.masteringDisplay);
    if (!parsed) return undefined;
    masteringDisplay = parsed;
  } else {
    // 早期 V3 只有亮度范围而没有色度坐标；允许读取，但绝不伪造 MDCV。
    const legacyMax = readOptionalNonNegative(value.maxLuminanceNits);
    const legacyMin = readOptionalNonNegative(value.minLuminanceNits);
    if (legacyMax === null || legacyMin === null) return undefined;
  }
  return {
    standard: value.standard,
    referenceWhiteNits,
    cicp,
    ...(contentLight ? { contentLight } : {}),
    ...(masteringDisplay ? { masteringDisplay } : {}),
  };
}

function parseColor(value: unknown): ImageEditColorModeV3 | null {
  if (!isRecord(value)) return null;
  if (!WORKING_SPACES.has(value.workingSpace as ImageEditWorkingSpaceV3)) return null;
  if (!BIT_DEPTHS.has(value.bitDepth as ImageEditBitDepthV3)) return null;
  if (!TRANSFER_FUNCTIONS.has(value.transferFunction as ImageEditTransferFunctionV3)) return null;
  const hdrMetadata = parseHdrMetadata(value.hdrMetadata);
  if (hdrMetadata === undefined) return null;
  if (value.iccProfileResourceId !== null && !isNonEmptyString(value.iccProfileResourceId)) return null;
  const transfer = value.transferFunction as ImageEditTransferFunctionV3;
  const isHdr = transfer === 'pq' || transfer === 'hlg';
  if (isHdr) {
    if (!hdrMetadata || hdrMetadata.standard !== transfer || value.workingSpace !== 'rec2020' || value.bitDepth === 8) {
      return null;
    }
  } else if (hdrMetadata !== null) {
    return null;
  }
  return {
    workingSpace: value.workingSpace as ImageEditWorkingSpaceV3,
    bitDepth: value.bitDepth as ImageEditBitDepthV3,
    transferFunction: transfer,
    hdrMetadata,
    iccProfileResourceId: value.iccProfileResourceId,
  };
}

function parseGeometry(value: unknown): ImageEditCanvasGeometryV3 | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.width) || Number(value.width) <= 0
    || !Number.isSafeInteger(value.height) || Number(value.height) <= 0) return null;
  if (!isRecord(value.orientation) || !ROTATIONS.has(Number(value.orientation.rotate))
    || typeof value.orientation.mirrored !== 'boolean') return null;
  const orientation: ImageEditOrientationV3 = {
    rotate: Number(value.orientation.rotate) as ImageEditOrientationV3['rotate'],
    mirrored: value.orientation.mirrored,
  };
  let crop: ImageEditCropRectV3 | null = null;
  if (value.crop !== null) {
    if (!isRecord(value.crop) || !isSafeInteger(value.crop.x) || value.crop.x < 0
      || !isSafeInteger(value.crop.y) || value.crop.y < 0
      || !isSafeInteger(value.crop.width) || value.crop.width <= 0
      || !isSafeInteger(value.crop.height) || value.crop.height <= 0) return null;
    const rotated = orientation.rotate === 90 || orientation.rotate === 270;
    const orientedWidth = rotated ? Number(value.height) : Number(value.width);
    const orientedHeight = rotated ? Number(value.width) : Number(value.height);
    if (value.crop.x + value.crop.width > orientedWidth || value.crop.y + value.crop.height > orientedHeight) return null;
    crop = { x: value.crop.x, y: value.crop.y, width: value.crop.width, height: value.crop.height };
  }
  return { width: Number(value.width), height: Number(value.height), orientation, crop };
}

function parseTransform(value: unknown): ImageEditTransformV3 | null {
  if (!isImageEditTransformInvertibleV3(value)) return null;
  return [value[0], value[1], value[2], value[3], value[4], value[5]];
}

function parseMask(value: unknown): ImageEditMaskReferenceV3 | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.inverted !== 'boolean') return undefined;
  if (value.kind === 'sparse-mask') {
    const tiles = parseTiles(value.tiles);
    if (value.storage !== 'mask-float32'
      || !isNonEmptyString(value.maskId)
      || value.tileSize !== IMAGE_EDIT_MASK_TILE_SIZE_V3
      || (value.defaultValue !== 0 && value.defaultValue !== 1)
      || !tiles) return undefined;
    return {
      kind: 'sparse-mask',
      storage: 'mask-float32',
      maskId: value.maskId,
      tileSize: IMAGE_EDIT_MASK_TILE_SIZE_V3,
      defaultValue: value.defaultValue,
      tiles,
      inverted: value.inverted,
    };
  }
  if (!isNonEmptyString(value.resourceId)) return undefined;
  return { resourceId: value.resourceId, inverted: value.inverted };
}

function parseCommon(value: Record<string, unknown>): ImageEditLayerCommonV3 | null {
  const transform = parseTransform(value.transform);
  const mask = parseMask(value.mask);
  if (!isNonEmptyString(value.id) || typeof value.name !== 'string'
    || typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean'
    || !isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1
    || !IMAGE_EDIT_BLEND_MODES_V3.includes(value.blendMode as never)
    || !transform || mask === undefined) return null;
  return {
    id: value.id,
    name: value.name,
    visible: value.visible,
    locked: value.locked,
    opacity: value.opacity,
    blendMode: value.blendMode as ImageEditLayerCommonV3['blendMode'],
    transform,
    mask,
  };
}

function parseTiles(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const tiles: Record<string, string> = {};
  for (const [key, resourceId] of Object.entries(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key) || !key || !isNonEmptyString(resourceId)) return null;
    tiles[key] = resourceId;
  }
  return tiles;
}

function parseLayer(value: unknown, depth: number): ImageEditLayerV3 | null {
  if (!isRecord(value) || depth > 64) return null;
  const common = parseCommon(value);
  if (!common) return null;
  if (value.type === 'raster') {
    if (!isRecord(value.source) || (value.source.kind !== 'empty' && value.source.kind !== 'resource')) return null;
    if (value.source.kind === 'resource' && !isNonEmptyString(value.source.resourceId)) return null;
    const tiles = parseTiles(value.tiles);
    if (!tiles) return null;
    return {
      ...common,
      type: 'raster',
      source: value.source.kind === 'empty'
        ? { kind: 'empty' }
        : { kind: 'resource', resourceId: value.source.resourceId as string },
      tiles,
    } satisfies ImageEditRasterLayerV3;
  }
  if (value.type === 'annotation') {
    if (!Array.isArray(value.annotations)) return null;
    const annotations: MarkItem[] = [];
    for (const annotation of value.annotations) {
      const parsed = sanitizeMarkItem(annotation);
      if (!parsed) return null;
      annotations.push(parsed);
    }
    return { ...common, type: 'annotation', annotations } satisfies ImageEditAnnotationLayerV3;
  }
  if (value.type === 'effect') {
    if (common.transform.some((entry, index) => entry !== [1, 0, 0, 1, 0, 0][index])) return null;
    const params = cloneImageEditJsonObjectV3(value.params);
    if (!isNonEmptyString(value.effectId) || !params || typeof value.renderable !== 'boolean') return null;
    let legacyOperation: ImageEditEffectLayerV3['legacyOperation'];
    if (value.legacyOperation !== undefined) {
      if (!isRecord(value.legacyOperation) || value.legacyOperation.sourceVersion !== 2) return null;
      const operation = cloneImageEditJsonObjectV3(value.legacyOperation.operation);
      if (!operation) return null;
      legacyOperation = { sourceVersion: 2, operation };
    }
    if (!value.renderable && !legacyOperation) return null;
    return {
      ...common,
      type: 'effect',
      effectId: value.effectId,
      params,
      renderable: value.renderable,
      ...(legacyOperation ? { legacyOperation } : {}),
    } satisfies ImageEditEffectLayerV3;
  }
  if (value.type === 'adjustment') {
    if (common.transform.some((entry, index) => entry !== [1, 0, 0, 1, 0, 0][index])) return null;
    const params = cloneImageEditJsonObjectV3(value.params);
    if (!isNonEmptyString(value.adjustmentId) || !params || typeof value.renderable !== 'boolean') return null;
    return {
      ...common,
      type: 'adjustment',
      adjustmentId: value.adjustmentId,
      params,
      renderable: value.renderable,
    } satisfies ImageEditAdjustmentLayerV3;
  }
  if (value.type === 'group') {
    if (!Array.isArray(value.children) || typeof value.isolated !== 'boolean') return null;
    const children: ImageEditLayerV3[] = [];
    for (const child of value.children) {
      const parsed = parseLayer(child, depth + 1);
      if (!parsed) return null;
      children.push(parsed);
    }
    return { ...common, type: 'group', children, isolated: value.isolated } satisfies ImageEditGroupLayerV3;
  }
  return null;
}

function parseDocument(value: Record<string, unknown>): ImageEditDocumentV3 | null {
  if (!isNonEmptyString(value.id) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null;
  const geometry = parseGeometry(value.geometry);
  const color = parseColor(value.color);
  if (!geometry || !color || !Array.isArray(value.layers)) return null;
  const layers: ImageEditLayerV3[] = [];
  const ids = new Set<string>();
  const registerIds = (layer: ImageEditLayerV3): boolean => {
    if (ids.has(layer.id)) return false;
    ids.add(layer.id);
    return layer.type !== 'group' || layer.children.every(registerIds);
  };
  for (const valueLayer of value.layers) {
    const layer = parseLayer(valueLayer, 0);
    if (!layer || !registerIds(layer)) return null;
    layers.push(layer);
  }
  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION_V3,
    id: value.id,
    revision: Number(value.revision),
    geometry,
    color,
    layers,
  };
}

export function decodeImageEditDocumentV3(value: unknown): ImageEditDocumentDecodeResultV3 {
  const input = parseInput(value);
  if (input.issue) return { document: null, sourceFormat: 'invalid', issues: [input.issue] };
  if (!isRecord(input.value)) return { document: null, sourceFormat: 'invalid', issues: ['invalid-document'] };
  if (input.value.version !== IMAGE_EDIT_DOCUMENT_VERSION_V3) {
    return {
      document: null,
      sourceFormat: typeof input.value.version === 'number' ? 'unknown-version' : 'invalid',
      issues: [typeof input.value.version === 'number' ? 'unknown-version' : 'missing-version'],
    };
  }
  const document = parseDocument(input.value);
  return document
    ? { document, sourceFormat: 'v3', issues: [] }
    : { document: null, sourceFormat: 'invalid', issues: ['invalid-v3-document'] };
}

export function parseImageEditDocumentV3(value: unknown): ImageEditDocumentV3 {
  const result = decodeImageEditDocumentV3(value);
  if (!result.document) throw new InvalidImageEditDocumentV3Error(result.issues.join(', '));
  return result.document;
}

export function stringifyImageEditDocumentV3(document: ImageEditDocumentV3): string {
  const validated = parseImageEditDocumentV3(document);
  return JSON.stringify(validated);
}
