/** HQ-ICON（YuKongA，MIT）获取方法的正式宿主装配；文件与素材登记复用已有服务。 */
import os from 'node:os'
import { createAsset, deleteAsset, inspectAsset } from '../asset-library'
import { getDocumentService } from '../documents/runtime'
import { createMainLogger } from '../logging'
import { AppStoreIconService } from './service'

export const appStoreIconService = new AppStoreIconService({
  logger: createMainLogger('main.app-store-icons'), tempRoot: os.tmpdir(),
  requireProject: async id => {
    const projects = await getDocumentService().listProjects({ includeDrafts: true })
    const project = projects.find(item => item.id === id)
    if (!project || project.missing) throw new Error(`项目 ${id} 不存在或其文件夹已丢失，请用 list_projects 重新取得可用项目。`)
  },
  importFile: input => getDocumentService().importFile(input),
  createAsset, inspectAsset, deleteAsset,
})
