import { z } from 'zod'
import { styleKitSchema, type StyleKit } from '@/core/videoEdit/styleKit'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'
import { publishVideoEdit } from './videoEditService'

export const STYLE_KIT_STORAGE_KEY = 'video-edit-style-kits'
const schema = z.array(styleKitSchema).superRefine((values, context) => { if (new Set(values.map(value => value.id)).size !== values.length || values.some(value => value.id.startsWith('builtin:'))) context.addIssue({ code: 'custom', message: '自定义风格标识重复或覆盖了内置风格。' }) })
export class VideoEditStyleKitLibrary extends VideoEditLocalLibrary<StyleKit> {
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage, publish: () => void = () => publishVideoEdit(true)) { super(STYLE_KIT_STORAGE_KEY, schema, storage, publish) }
  list(): StyleKit[] { return structuredClone([...BUILTIN_STYLE_KITS, ...this.custom()]) }
  save(kit: StyleKit): StyleKit { const value = styleKitSchema.parse({ ...kit, id: crypto.randomUUID(), revision: 0 }); this.replace([...this.custom(), value]); return value }
  update(id: string, kit: StyleKit): StyleKit { const previous = this.custom().find(value => value.id === id); if (!previous) throw new Error('只能修改本机自定义风格；内置风格请复制。'); const next = styleKitSchema.parse({ ...kit, id, revision: previous.revision + 1 }); this.replace(this.custom().map(value => value.id === id ? next : value)); return next }
  remove(id: string): void { if (!this.custom().some(value => value.id === id)) throw new Error('只能删除本机自定义风格。'); this.replace(this.custom().filter(value => value.id !== id)) }
}
export const videoEditStyleKitLibrary = new VideoEditStyleKitLibrary()
