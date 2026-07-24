import { createEmptyImageEditDocument, createImageEditDocumentFromMarkDoc } from './document';
import { parseMarkDoc, parseMarkItems, sanitizeMarkCrop, sanitizeMarkOrientation } from './markCodec';
import {
  IMAGE_EDIT_DOCUMENT_VERSION,
  IMAGE_EDIT_OPERATION_IDS,
  type AnnotationOperationParams,
  type CropOperationParams,
  type ImageEditDocument,
  type ImageEditOperation,
  type OrientationOperationParams,
} from './types';

export type ImageEditDocumentSourceFormat =
  | 'v2'
  | 'v1'
  | 'mark-items'
  | 'invalid'
  | 'unknown-version';

export interface ImageEditDocumentDecodeResult {
  document: ImageEditDocument;
  sourceFormat: ImageEditDocumentSourceFormat;
  migrated: boolean;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInput(value: unknown): { value: unknown; invalidJson: boolean } {
  if (typeof value !== 'string') return { value, invalidJson: false };
  try {
    return { value: JSON.parse(value) as unknown, invalidJson: false };
  } catch {
    return { value: null, invalidJson: true };
  }
}

function cloneJsonValue(value: unknown): unknown | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map(cloneJsonValue);
    return values.some((entry) => entry === undefined) ? undefined : values;
  }
  if (!isRecord(value)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = cloneJsonValue(entry);
    if (cloned === undefined) return undefined;
    output[key] = cloned;
  }
  return output;
}

function parseOperation(value: unknown): ImageEditOperation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.operationId !== 'string' || !value.operationId || !isRecord(value.params)) return null;
  let params: object;
  if (value.operationId === IMAGE_EDIT_OPERATION_IDS.orientation) {
    params = sanitizeMarkOrientation(value.params) satisfies OrientationOperationParams;
  } else if (value.operationId === IMAGE_EDIT_OPERATION_IDS.annotations) {
    if (!Array.isArray(value.params.items)) return null;
    const items = parseMarkItems(value.params.items);
    if (items.length !== value.params.items.length) return null;
    params = { items } satisfies AnnotationOperationParams;
  } else if (value.operationId === IMAGE_EDIT_OPERATION_IDS.crop) {
    if (value.params.rect !== null && sanitizeMarkCrop(value.params.rect) === null) return null;
    params = { rect: sanitizeMarkCrop(value.params.rect) } satisfies CropOperationParams;
  } else {
    const cloned = cloneJsonValue(value.params);
    if (!isRecord(cloned)) return null;
    params = cloned;
  }
  return {
    id: value.id,
    operationId: value.operationId,
    enabled: value.enabled !== false,
    params,
  };
}

export function decodeImageEditDocument(value: unknown): ImageEditDocumentDecodeResult {
  const parsed = parseInput(value);
  if (parsed.invalidJson) {
    return { document: createEmptyImageEditDocument(), sourceFormat: 'invalid', migrated: false, issues: ['invalid-json'] };
  }
  const source = parsed.value;
  if (Array.isArray(source)) {
    return {
      document: createImageEditDocumentFromMarkDoc(parseMarkDoc(source)),
      sourceFormat: 'mark-items',
      migrated: true,
      issues: [],
    };
  }
  if (!isRecord(source)) {
    return { document: createEmptyImageEditDocument(), sourceFormat: 'invalid', migrated: false, issues: ['invalid-document'] };
  }
  if (source.version === IMAGE_EDIT_DOCUMENT_VERSION) {
    if (!Array.isArray(source.operations)) {
      return { document: createEmptyImageEditDocument(), sourceFormat: 'invalid', migrated: false, issues: ['missing-operations'] };
    }
    const operations = source.operations.map(parseOperation);
    if (operations.some((operation) => operation === null)) {
      return { document: createEmptyImageEditDocument(), sourceFormat: 'invalid', migrated: false, issues: ['invalid-operation'] };
    }
    const ids = new Set<string>();
    for (const operation of operations) {
      if (!operation || ids.has(operation.id)) {
        return { document: createEmptyImageEditDocument(), sourceFormat: 'invalid', migrated: false, issues: ['duplicate-operation-instance'] };
      }
      ids.add(operation.id);
    }
    return {
      document: { version: IMAGE_EDIT_DOCUMENT_VERSION, operations: operations as ImageEditOperation[] },
      sourceFormat: 'v2',
      migrated: false,
      issues: [],
    };
  }
  if (typeof source.version === 'number' && source.version !== 1) {
    return { document: createEmptyImageEditDocument(), sourceFormat: 'unknown-version', migrated: false, issues: ['unknown-version'] };
  }
  return {
    document: createImageEditDocumentFromMarkDoc(parseMarkDoc(source)),
    sourceFormat: 'v1',
    migrated: true,
    issues: [],
  };
}

export function parseImageEditDocument(value: unknown): ImageEditDocument {
  return decodeImageEditDocument(value).document;
}

export function stringifyImageEditDocument(document: ImageEditDocument): string {
  return JSON.stringify(document);
}
