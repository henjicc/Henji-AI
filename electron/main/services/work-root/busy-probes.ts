/*
 * 作品目录更换前的统一忙碌检查（4.4 收 4.2 遗留）：会往作品目录写文件的主进程长任务
 * （生成结果保存、视频导出、图片导出、口播处理、镜头参考渲染、单文件包导出导入）各自登记一个探针，
 * 更换开始前逐个询问，有任一在进行就拒绝并说明是哪类任务。
 *
 * 探针登记在各自模块初始化处，模块没有加载过就没有这类任务，不用检查。
 */

export interface WorkRootBusyProbe {
  /** 给用户看的原因，如“还有视频正在导出”。 */
  reason: string
  isBusy: () => boolean
}

const probes = new Map<string, WorkRootBusyProbe>()

/** 同一 ID 重复登记以最后一次为准（窗口重建、测试重置时不会累积）。 */
export function registerWorkRootBusyProbe(id: string, probe: WorkRootBusyProbe): void {
  probes.set(id, probe)
}

/** 第一个忙碌任务的原因；都空闲时返回 null。探针本身出错按忙碌处理（宁可不换，也不在写入中途移动）。 */
export function findWorkRootBusyReason(): string | null {
  for (const probe of probes.values()) {
    try {
      if (probe.isBusy()) return probe.reason
    } catch {
      return probe.reason
    }
  }
  return null
}

/** 仅供测试：清空登记。 */
export function resetWorkRootBusyProbesForTest(): void {
  probes.clear()
}
