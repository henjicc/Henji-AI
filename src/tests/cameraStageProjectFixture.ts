import { afterEach, beforeEach } from 'vitest'
import { documentKindRegistry } from '@/core/documents/kinds'
import {
  ensureCameraStageProjectRuntime,
  resetCameraStageProjectInstancesForTests,
  setCameraStageDocumentRegistryForTests,
  type CameraStageProjectInstance,
} from '@/features/cameraStage/application/cameraStageProjectRuntime'
import { sceneToDocumentContent, type StageSceneRuntimeSnapshot } from '@/features/cameraStage/domain/sceneSerialization'
import { attachCameraStageStore } from '@/features/cameraStage/store/cameraStageStore'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'

/*
 * 镜头参考的单元测试夹具（3.2）：把场景写成一份镜头参考文档（内存替身里的文档文件），
 * 再经正式的文档会话打开成实例并附着到界面 store。不跑主进程，也不需要 window。
 *
 * 用 applicationHarness 的测试（装了 harnessNativeStorage）不调用这里的 loadCameraStageTestProject，
 * 直接走正式命令与应用唯一的会话登记表；只借这里的前后重置。
 */

let documents: FakeDocumentCommands | null = null

async function reset(): Promise<void> {
  // 只撤掉本夹具装上的替身登记表；用例自己装的（如运行时测试）由用例管理。
  // vitest 的 beforeEach 可能并行执行，不能假设本钩子先于用例自己的钩子。
  if (documents) setCameraStageDocumentRegistryForTests(null)
  documents = null
  await resetCameraStageProjectInstancesForTests()
}

beforeEach(reset)
afterEach(reset)

/** 当前用例的镜头参考文档仓库（断言“磁盘”上的内容与写入次数）；还没造数据时为 null。 */
export function cameraStageTestDocuments(): FakeDocumentCommands | null {
  return documents
}

export async function loadCameraStageTestProject(
  snapshot: StageSceneRuntimeSnapshot,
  project: { id: string; name: string },
): Promise<CameraStageProjectInstance> {
  if (!documents) {
    documents = new FakeDocumentCommands()
    setCameraStageDocumentRegistryForTests(new DocumentSessionRegistry({
      commands: documents,
      prompter: createScriptedPrompter(),
      kinds: documentKindRegistry,
    }))
  }
  documents.seed({ kind: 'camera_stage', id: project.id, name: project.name, content: structuredClone(sceneToDocumentContent(snapshot)) })
  const instance = await ensureCameraStageProjectRuntime(project.id)
  attachCameraStageStore(instance.store)
  return instance
}
