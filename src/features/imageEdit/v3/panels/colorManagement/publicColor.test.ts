// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage';
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession';
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { imageEditV3DocumentRef } from '../../application/imageEditDocumentRefs';
import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry';
import type { ApplicationControlAccessContext } from '@/core/application-control';

// Only the pixel/storage boundary is replaced; reflection, authorization, transaction,
// mutation executor, reducer, persistence and undo are the formal application path.
vi.mock('../../smartContent/service', async () => {
  const actual = await vi.importActual<typeof import('../../smartContent/service')>('../../smartContent/service');
  return { ...actual, prepareSmartContentAppearanceV3: async () => ({ source: { kind: 'empty' }, tiles: {}, width: 4, height: 3, bytes: {}, release: async () => undefined }) };
});
const access: ApplicationControlAccessContext = { exposure: 'assistant', permissions: new Set(['image_edit:read', 'image_edit:write']), acceptedDataClasses: new Set(['C0', 'C1']) };
let dispose: (() => void) | undefined;
beforeEach(installHarnessNativeStorage);
afterEach(() => { dispose?.(); uninstallHarnessNativeStorage(); });
it.each(['convert', 'assign'] as const)('正式通用属性 %s 可发现、授权写入、读回及一次撤销，HDR 错参拒绝后可改正', async mode => {
  const document = createImageEditDocumentV3({ width: 4, height: 3, documentId: `color-public-${mode}` });
  const bus = new ImageEditCommandBusV3(document);
  dispose = registerPersistedImageEditTestSession(`color-public-session-${mode}`, bus);
  const registry = getApplicationReflectionRegistry(), engine = getApplicationControlExecutionEngine();
  const target = imageEditV3DocumentRef(document.id), propertyId = 'image_edit.document.color_settings';
  const descriptor = registry.describe({ entityTypes: ['image_edit.document'] }, access).properties.find(value => value.id === propertyId)!;
  if (descriptor.value.kind !== 'json') throw new Error('缺少颜色 schema');
  expect(registry.resolveSchema(descriptor.value.schemaRef, access)).toMatchObject({ properties: { mode: { enum: ['convert', 'assign'] } } });
  const before = await registry.readEntity(target, [propertyId], access);
  const context = { ...access, requestId: `color-public-control-${mode}` };
  const value = { mode, workingSpace: 'display-p3', bitDepth: 16, transferFunction: 'srgb' };
  const plan = await engine.plan({ summary: '转换到 P3 16 位', transactionMode: 'atomic', steps: [{ kind: 'mutation', target, entityType: 'image_edit.document', expectedRevisions: before.revisions, mutations: [{ propertyId, operation: 'set', value }] }] }, context);
  const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: before.revisions, idempotencyKey: `color-public-${mode}` }, context);
  expect(result.status, JSON.stringify(result)).toBe('completed');
  expect((await registry.readEntity(target, [propertyId], access)).properties[propertyId]).toEqual({ ...value, mode: 'convert' });
  if (result.status !== 'completed' || !result.undoRef) throw new Error('颜色调整缺少撤销');
  const undone = await engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: `color-public-undo-${mode}` }, context);
  expect(undone.status, JSON.stringify(undone)).toBe('completed');
  expect(bus.getSnapshot().document.color).toEqual(document.color);
  expect((await registry.readEntity(target, [propertyId], { ...access, permissions: new Set() })).properties).toEqual({});
  const afterUndo = await registry.readEntity(target, [propertyId], access);
  const invalid = await engine.plan({ summary: '错误 HDR 输入', transactionMode: 'atomic', steps: [{ kind: 'mutation', target,
    entityType: 'image_edit.document', expectedRevisions: afterUndo.revisions, mutations: [{ propertyId, operation: 'set', value: { ...value, workingSpace: 'srgb', bitDepth: 8, transferFunction: 'pq' } }] }] }, context);
  const refused = await engine.commit({ planRef: invalid.planRef, expectedRevisions: afterUndo.revisions, idempotencyKey: `color-public-invalid-${mode}` }, context);
  expect(refused.status).not.toBe('completed');
  expect(JSON.stringify(refused)).toContain('HDR');
  expect(bus.getSnapshot().document.color).toEqual(document.color);
  const recovery = await engine.plan({ summary: '改正颜色配置', transactionMode: 'atomic', steps: [{ kind: 'mutation', target,
    entityType: 'image_edit.document', expectedRevisions: afterUndo.revisions, mutations: [{ propertyId, operation: 'set', value }] }] }, context);
  const recovered = await engine.commit({ planRef: recovery.planRef, expectedRevisions: afterUndo.revisions, idempotencyKey: `color-public-recovery-${mode}` }, context);
  expect(recovered.status, JSON.stringify(recovered)).toBe('completed');
});
