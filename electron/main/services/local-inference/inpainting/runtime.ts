import fs from 'node:fs/promises'
import path from 'node:path'
import { getProgramStoreDir } from '../../appPaths'
import { createMainLogger } from '../../logging'
import { ensureLocalModel } from '../../local-models/runtime'
import { getLocalInferenceHost } from '../../smart-regions/runtime'
import { registerWorkRootBusyProbe } from '../../work-root/busy-probes'
import { executionProviderOrder } from '../providers'
import { ImageInpaintService, type InpaintResourceAccess } from './service'

const services = new Set<WeakRef<ImageInpaintService>>()
registerWorkRootBusyProbe('image_inpaint', { reason: '还有图片正在修补', isBusy: () => {
  let busy = false
  for (const ref of services) {
    const service = ref.deref()
    if (service) busy ||= service.hasActiveJobs()
    else services.delete(ref)
  }
  return busy
} })

/** 由后续领域宿主注入正式资源解析/发布器，无新的 IPC、路径输入或独立推理进程。 */
export function createImageInpaintService(resources: InpaintResourceAccess): ImageInpaintService {
  const logger = createMainLogger('main.image_inpaint')
  const service = new ImageInpaintService({
    resources, inference: getLocalInferenceHost(), providers: executionProviderOrder(process.platform),
    ensureModel: async id => {
      const model = await ensureLocalModel(id)
      const file = model.files.find(entry => entry.role === 'model')
      if (!file) throw new Error('图片修补模型文件未就绪，请重新下载。')
      return file.path
    },
    temporaryPath: async id => {
      const directory = path.join(getProgramStoreDir('imageEditor'), 'inpaint-temporary')
      await fs.mkdir(directory, { recursive: true })
      return path.join(directory, `${id}.png`)
    },
    removeTemporary: file => fs.rm(file, { force: true }),
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  services.add(new WeakRef(service))
  return service
}
