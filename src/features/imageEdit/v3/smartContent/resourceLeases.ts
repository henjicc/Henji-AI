import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import { createLogger } from '@/core/logging';

const recoveryLeases = new WeakMap<ImageEditCommandBusV3, Set<() => Promise<void>>>();
const listeningBuses = new WeakSet<ImageEditCommandBusV3>();
const logger = createLogger('features.imageEdit.v3.smart_content');
/** 未保存的内容缓存受实例租约保护；失败时保留，确认保存或关闭实例后释放。 */
export function retainSmartContentResourcesV3(bus: ImageEditCommandBusV3, release: () => Promise<void>): () => Promise<void> {
  let leases = recoveryLeases.get(bus);
  if (!leases) {
    leases = new Set(); recoveryLeases.set(bus, leases);
  }
  if (!listeningBuses.has(bus)) {
    listeningBuses.add(bus);
    bus.getLifecycleSignal().addEventListener('abort', () => {
      void releaseSmartContentResourcesV3(bus).catch(error => logger.warn('关闭智能内容时释放资源失败', {
        event: 'image_edit.smart_content.resources.release.failed', error,
      }));
    }, { once: true });
  }
  leases.add(release);
  const retained = leases;
  return async () => { if (retained.delete(release)) await release(); };
}
export async function releaseSmartContentResourcesV3(bus: ImageEditCommandBusV3): Promise<void> {
  const leases = recoveryLeases.get(bus);
  if (!leases) return;
  recoveryLeases.delete(bus);
  for (const release of leases) await release();
}
