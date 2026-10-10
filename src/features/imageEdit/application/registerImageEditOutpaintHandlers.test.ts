// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeApplicationCapabilityResult } from '@/features/application-control/capabilities/registry';
import { createApplicationCallerGrant } from '@/core/application-control/callerContext';
import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity';
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory';
import { ImageEditCommandBusV3 } from '../v3/application/imageEditCommandBus';
import { imageEditV3DocumentRef } from '../v3/application/imageEditDocumentRefs';
import { registerPersistedImageEditTestSession } from '@/tests/imageEditPersistenceTestSession';
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage';

const fixture = vi.hoisted(() => ({ prepare: vi.fn(), start: vi.fn(), recover: vi.fn(), read: vi.fn() }));
vi.mock('../v3/application/imageEditOutpaintServiceV3', () => ({
  prepareImageEditOutpaintV3: fixture.prepare, startImageEditOutpaintV3: fixture.start,
  recoverImageEditOutpaintV3: fixture.recover, readImageEditOutpaintJobV3: fixture.read,
}));
beforeEach(() => { vi.clearAllMocks(); installHarnessNativeStorage(); });
afterEach(() => uninstallHarnessNativeStorage());

describe('扩图正式公共执行与读回（生成服务替身，不付费）', () => {
  it('检查、可信操作提交、状态与恢复同源，拒绝跨文档读回', async () => {
    const document = createImageEditDocumentV3({ width: 100, height: 80, documentId: crypto.randomUUID() });
    const bus = new ImageEditCommandBusV3(document), dispose = registerPersistedImageEditTestSession('outpaint-public', bus);
    const documentRef = imageEditV3DocumentRef(document.id), input = { documentRef, margins: { right: .25, bottom: 0 }, prompt: '延续背景' };
    const operation = crypto.randomUUID(), taskId = applicationGenerationTaskId(operation);
    const context = { signal: new AbortController().signal, taskId: operation };
    fixture.prepare.mockResolvedValue({ preparation: { prepared: true, modelId: 'fixture', providerId: 'fixture', mediaType: 'image', options: {} } });
    fixture.start.mockResolvedValue({ taskId });
    fixture.read.mockReturnValue({ taskId, documentId: document.id, status: 'placed', progress: 100, layerId: 'new-layer' });
    fixture.recover.mockResolvedValue({ taskId, documentId: document.id, status: 'placing', progress: 70 });
    const execute = (id: string, value: unknown) => executeApplicationCapabilityResult({ id, version: 1, input: value }, context);
    try {
      const checked = await execute('prepare_image_edit_outpaint', input); expect(checked.ok, JSON.stringify(checked)).toBe(true);
      const submitted = await execute('generate_image_edit_outpaint', input); expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
      expect(fixture.start).toHaveBeenCalledWith(expect.objectContaining({ documentId: document.id, margins: input.margins }), { operationId: taskId, signal: context.signal });
      const target = { documentRef, taskRef: { kind: 'generation.task', id: taskId } };
      const read = await execute('get_image_edit_outpaint', target); expect(read.ok, JSON.stringify(read)).toBe(true);
      if (read.ok) expect(read.data).toMatchObject({ status: 'placed', layerRef: { kind: 'image_edit.layer' } });
      expect((await execute('recover_image_edit_outpaint', target)).ok).toBe(true);
      expect(fixture.recover).toHaveBeenCalledWith(document.id, taskId); expect(fixture.start).toHaveBeenCalledTimes(1);
      fixture.read.mockReturnValue({ taskId, documentId: 'another-document', status: 'placed' });
      expect((await execute('get_image_edit_outpaint', target)).ok).toBe(false);
    } finally { dispose(); bus.dispose(); }
  });
  it('未授权生成或缺可信操作身份时不会调用生成服务', async () => {
    const document = createImageEditDocumentV3({ width: 100, height: 80, documentId: crypto.randomUUID() });
    const bus = new ImageEditCommandBusV3(document), dispose = registerPersistedImageEditTestSession('outpaint-denied', bus);
    const invocation = { id: 'generate_image_edit_outpaint', version: 1, input: { documentRef: imageEditV3DocumentRef(document.id), margins: { right: .25, bottom: 0 }, prompt: '延续背景' } };
    try {
      const signal = new AbortController().signal;
      const grant = createApplicationCallerGrant({ callerId: 'readonly', capabilityIds: [invocation.id], permissions: ['image_edit:read'], allowWrites: false, allowDestructive: false });
      expect((await executeApplicationCapabilityResult(invocation, { signal, callerGrant: grant, taskId: 'trusted' })).ok).toBe(false);
      expect((await executeApplicationCapabilityResult(invocation, { signal })).ok).toBe(false);
      expect(fixture.start).not.toHaveBeenCalled();
    } finally { dispose(); bus.dispose(); }
  });
});
