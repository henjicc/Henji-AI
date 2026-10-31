import { z } from 'zod'
import type { ApplicationFieldDefinition } from '@/core/application-control'
import { videoEditSchemaRef } from './videoEditFields'
import { VIDEO_EDIT_EFFECT_LIBRARY_SCOPE, type LibraryData } from './videoEditEffectPresets'

export const EFFECT_LIBRARY_ENTITY = 'video_edit.effect_library'
export const effectFavoriteIdsSchema = z.array(z.string()).refine(ids => new Set(ids).size === ids.length, '收藏条目不能重复。')
export const effectLibraryFields: readonly ApplicationFieldDefinition<LibraryData, LibraryData, 'toggleFavorite' | 'setFavorites'>[] = [{
  propertyId: `${EFFECT_LIBRARY_ENTITY}.favorite_ids`,
  storeActions: ['toggleFavorite', 'setFavorites'],
  read: library => library.favorites,
  writer: { write: (draft, mutation) => { draft.favorites = effectFavoriteIdsSchema.parse(mutation.value) } },
  descriptor: {
    id: `${EFFECT_LIBRARY_ENTITY}.favorite_ids`, entityType: EFFECT_LIBRARY_ENTITY, version: 1, title: '效果收藏',
    description: '收藏条目标识。全局风格件使用 preset:<风格件 id>；内置效果、过渡使用目录条目的 id。读取当前列表后增加或移除条目，用通用修改写回，可取消收藏。',
    value: { kind: 'json', schemaRef: videoEditSchemaRef('property', `${EFFECT_LIBRARY_ENTITY}.favorite_ids.value`) },
    nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['video_edit:read'], write: ['video_edit:write'] },
    revisionScopes: [VIDEO_EDIT_EFFECT_LIBRARY_SCOPE], schemaRef: videoEditSchemaRef('property', `${EFFECT_LIBRARY_ENTITY}.favorite_ids`),
  },
}]
