import type { z } from 'zod'
import { createLogger } from '@/core/logging'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'

/** Shared local-library persistence used by title templates and style kits. */
export class VideoEditLocalLibrary<T> {
  private values: T[] = []
  private error = ''
  private readonly logger = createLogger('features.videoEdit.localLibrary')
  constructor(private readonly key: string, private readonly schema: z.ZodType<T[]>, private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, private readonly publish: () => void) {
    this.logger.debug('local_library.load.start', '读取本机创作库', { context: { key } })
    try { const raw = storage?.getItem(key); if (raw) this.values = schema.parse(JSON.parse(raw)); this.logger.debug('local_library.load.completed', '本机创作库已读取', { context: { key } }) }
    catch (error) { this.error = '本机创作库读取失败，原数据已保留；请重启后重试。'; this.logger.error('local_library.load.failed', this.error, { error, context: { key } }) }
  }
  custom(): T[] { return structuredClone(this.values) }
  loadError(): string { return this.error }
  replace(values: readonly T[]): void {
    assertApplicationWritesAllowed()
    this.logger.info('local_library.save.start', '保存本机创作库', { context: { key: this.key } })
    try { if (this.error) throw new Error(this.error); if (!this.storage) throw new Error('本机创作库存储不可用。'); const parsed = this.schema.parse(values); this.storage.setItem(this.key, JSON.stringify(parsed)); this.values = parsed; this.publish(); this.logger.info('local_library.save.completed', '本机创作库已保存', { context: { key: this.key, count: parsed.length } }) }
    catch (error) { this.logger.error('local_library.save.failed', '本机创作库未能保存', { error, context: { key: this.key } }); throw error }
  }
}
