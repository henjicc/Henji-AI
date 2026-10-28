import { VIDEO_EDIT_EXPORT_CHANNELS, type VideoEditExportPlatform } from '../../src/platform/contracts/videoEditExport'

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`导出登记缺少 ${field}。`)
  return value
}

/** 页面编号随预加载脚本每次加载重新生成：主进程靠它分辨重载前后的页面。 */
export function createVideoEditExportApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): VideoEditExportPlatform {
  const pageId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return {
    register: request => {
      if (!request || !Array.isArray(request.jobs) || !Array.isArray(request.snapshots) || request.snapshots.some(value => typeof value !== 'string')) throw new Error('导出登记格式无效。')
      return invoke(VIDEO_EDIT_EXPORT_CHANNELS.register, { pageId, snapshots: request.snapshots, jobs: request.jobs })
    },
    update: update => invoke(VIDEO_EDIT_EXPORT_CHANNELS.update, { pageId, ...update, id: text(update?.id, 'id') }),
    createOutput: (id, path) => invoke(VIDEO_EDIT_EXPORT_CHANNELS.createOutput, { pageId, id: text(id, 'id'), path: text(path, 'path') }),
    outputPublished: id => invoke(VIDEO_EDIT_EXPORT_CHANNELS.outputPublished, { pageId, id: text(id, 'id') }),
    discardLeftovers: id => invoke(VIDEO_EDIT_EXPORT_CHANNELS.discardLeftovers, { pageId, id: text(id, 'id') }),
    remove: ids => { if (!Array.isArray(ids)) throw new Error('导出登记格式无效。'); return invoke(VIDEO_EDIT_EXPORT_CHANNELS.remove, { pageId, ids }) },
    restore: () => invoke(VIDEO_EDIT_EXPORT_CHANNELS.restore, { pageId }),
  }
}
