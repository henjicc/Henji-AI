import { audioEditContentSchema } from '@/core/documents/kinds/audioEdit'
import { importAudioEditMedia, openAudioEditDocument } from '@/features/audioEdit'
import { getPlatform } from '@/platform/runtime'

/** 崩溃可能发生在草稿已落盘、恢复记录尚未清除之间；读回已有草稿，避免重复导入。 */
export async function importCapturedAudio(outputPath: string): Promise<void> {
  const documents = getPlatform().documents
  const drafts = (await documents.listDocuments({ kind: 'audio_edit', includeMissing: false })).filter(document => document.draft)
  for (const draft of drafts) {
    const read = await documents.readDocument({ id: draft.id })
    const content = audioEditContentSchema.parse(read.content)
    if (content.source?.sourcePath.replaceAll('\\', '/') !== outputPath.replaceAll('\\', '/')) continue
    await openAudioEditDocument({ id: draft.id })
    return
  }
  await importAudioEditMedia(outputPath)
}
