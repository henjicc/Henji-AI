import { describe, expect, it } from 'vitest'

import {
  applicationCatalogMigrationPolicySchema,
  applicationChangePlanSchema,
  applicationEntitySnapshotSchema,
  applicationEntityTypeDescriptorSchema,
  applicationMediaRefSchema,
  applicationObservationRequestSchema,
  applicationObservationResultSchema,
  applicationOperationProgressSchema,
  applicationPropertyDescriptorSchema,
  applicationTransactionResultSchema,
  createKnownApplicationPropertyIdSchema,
  jsonValueSchema,
} from './index'

const schemaRef = {
  catalogVersion: 'application-capabilities/v2',
  kind: 'entity' as const,
  id: 'camera_stage.object',
  version: 1,
  digest: `sha256:${'a'.repeat(64)}`,
}

describe('application-control contracts', () => {
  it('核心实体和属性描述可严格序列化', () => {
    expect(applicationEntityTypeDescriptorSchema.parse({
      id: 'camera_stage.object',
      domain: 'camera_stage',
      version: 1,
      title: '三维对象',
      description: '场景中的可控对象。',
      refKind: 'camera_stage.object',
      dataClass: 'C1',
      exposures: ['ui', 'assistant'],
      parentTypes: ['camera_stage.project'],
      revisionScopes: ['camera_stage.scene'],
      queryCapabilityIds: ['get_camera_stage_project'],
      schemaRef,
    })).toBeTruthy()
    expect(applicationPropertyDescriptorSchema.parse({
      id: 'transform.position',
      entityType: 'camera_stage.object',
      version: 1,
      title: '位置',
      description: '场景坐标。',
      value: { kind: 'vector3', unit: '米' },
      unit: '米',
      nullable: false,
      defaultValue: { x: 0, y: 0, z: 0 },
      dataClass: 'C1',
      exposures: ['ui', 'assistant'],
      requiredPermissions: { read: ['camera_stage:read'], write: ['camera_stage:write'] },
      revisionScopes: ['camera_stage.scene'],
      schemaRef: { ...schemaRef, kind: 'property', id: 'transform.position' },
    })).toBeTruthy()
    expect(applicationPropertyDescriptorSchema.safeParse({
      id: 'transform.position',
      entityType: 'camera_stage.object',
      version: 1,
      title: '位置',
      description: '场景坐标。',
      value: { kind: 'vector3' },
      nullable: false,
      dataClass: 'C1',
      exposures: ['assistant'],
      requiredPermissions: { read: [], write: [] },
      revisionScopes: ['camera_stage.scene'],
      schemaRef: { ...schemaRef, kind: 'property', id: 'transform.position' },
      executeScript: 'dangerous()',
    }).success).toBe(false)
  })

  it('只允许注册表声明的属性 ID', () => {
    const propertySchema = createKnownApplicationPropertyIdSchema([
      'transform.position',
      'camera.fov',
    ] as const)
    expect(propertySchema.parse('camera.fov')).toBe('camera.fov')
    expect(propertySchema.safeParse('store.internal_state').success).toBe(false)
    expect(propertySchema.safeParse('__proto__.value').success).toBe(false)
  })

  it('计划、提交结果、证据与目录迁移策略可序列化', () => {
    const plan = applicationChangePlanSchema.parse({
      contractVersion: 'application-control/v1',
      planRef: `plan:${'a'.repeat(20)}`,
      summary: '调整摄像机位置。',
      risk: 'R1',
      requiresApproval: false,
      atomic: true,
      transactionMode: 'atomic',
      steps: [{
        kind: 'mutation',
        target: { kind: 'camera_stage.object', id: 'camera-1', revision: 3 },
        entityType: 'camera_stage.object',
        expectedRevisions: { 'camera_stage.scene': 3 },
        mutations: [{ propertyId: 'transform.position', operation: 'set', value: { x: 1, y: 2, z: 3 } }],
      }],
      verificationConditions: [{
        kind: 'property_equals',
        target: { kind: 'camera_stage.object', id: 'camera-1' },
        propertyId: 'transform.position',
        expected: { x: 1, y: 2, z: 3 },
      }],
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-01T00:10:00.000Z',
    })
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
    expect(applicationTransactionResultSchema.parse({
      status: 'completed',
      transactionRef: `transaction:${'b'.repeat(20)}`,
      resultingRevisions: { 'camera_stage.scene': 4 },
      producedRefs: [],
      evidence: [{ kind: 'property_value', fact: '位置已更新。', data: { x: 1 }, capturedAt: '2026-08-01T00:00:01.000Z' }],
      verification: { verified: true, evidence: [], unmetConditions: [], checkedAt: '2026-08-01T00:00:01.000Z' },
      undoRef: `undo:${'c'.repeat(20)}`,
      completedAt: '2026-08-01T00:00:01.000Z',
    }).status).toBe('completed')
    expect(applicationCatalogMigrationPolicySchema.parse({
      fromVersion: 'application-capabilities/v1',
      toVersion: 'application-capabilities/v2',
      historicalCalls: 'read_only',
      replay: 'forbidden',
      removedCapabilityIds: [],
      migrationCompletedDomains: [],
    }).replay).toBe('forbidden')
    expect(applicationOperationProgressSchema.parse({
      state: 'waiting_external',
      message: '等待生成任务完成。',
      cancelable: true,
      updatedAt: '2026-08-01T00:00:02.000Z',
    }).state).toBe('waiting_external')
  })

  it('媒体和观察契约不接受裸路径或未知字段', () => {
    expect(applicationMediaRefSchema.parse({ kind: 'media.image', id: 'opaque-media-id' })).toBeTruthy()
    expect(applicationMediaRefSchema.safeParse({ kind: 'media.image', id: 'x', path: 'C:\\secret.png' }).success).toBe(false)
    const request = applicationObservationRequestSchema.parse({
      requestId: 'observe-1',
      target: { kind: 'surface', surfaceId: 'tool.camera_stage' },
      purpose: '验证构图。',
      requestedModalities: ['image'],
      acceptedDataClasses: ['C0', 'C1'],
      maxBytes: 2_000_000,
    })
    expect(request.target.kind).toBe('surface')
    expect(applicationObservationResultSchema.parse({
      requestId: 'observe-1',
      providerId: 'surface.camera_stage.viewport',
      target: { kind: 'surface', surfaceId: 'tool.camera_stage' },
      modality: 'image',
      dataClass: 'C1',
      mediaRef: { kind: 'media.image', id: 'opaque-media-id' },
      summary: '两个物体互不遮挡。',
      masks: [],
      capturedAt: '2026-08-01T00:00:02.000Z',
    }).summary).toContain('互不遮挡')
  })

  it('拒绝函数等非 JSON 值和实体快照未知字段', () => {
    expect(jsonValueSchema.safeParse({ action: () => undefined }).success).toBe(false)
    expect(applicationEntitySnapshotSchema.safeParse({
      ref: { kind: 'camera_stage.object', id: 'camera-1' },
      entityType: 'camera_stage.object',
      revisions: { 'camera_stage.scene': 1 },
      properties: { 'transform.position': { x: 0, y: 0, z: 0 } },
      capturedAt: '2026-08-01T00:00:00.000Z',
      localPath: 'C:\\private',
    }).success).toBe(false)
  })
})
