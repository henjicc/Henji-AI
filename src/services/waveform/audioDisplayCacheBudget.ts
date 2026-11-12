import { getPlatform } from '@/platform/runtime'
import { setSpectralTileMemoryBudget } from '@/core/audio/spectralTiles'

/*
 * 渲染层音频显示缓存（整段波形、频谱块）的内存预算，按这台电脑的物理内存取值：各占 1/64，64 GB 机器约 1 GB。
 * 预算只是淘汰目标，超出时淘汰最久没用的，不拒绝读取。
 * 保底值（波形 128 MB、频谱 256 MB）够十分钟级素材来回缩放，也是内存信息异步到达前使用的值。
 */

const MIB = 1024 * 1024
const WAVEFORM_MIN_BYTES = 128 * MIB
const SPECTRAL_MIN_BYTES = 256 * MIB
let machineBytes = 0
let requested = false

const share = (minBytes: number): number => Math.max(minBytes, Math.floor(machineBytes / 64))

/** 第一次用到音频显示缓存时读取一次物理内存。 */
export function loadAudioDisplayCacheBudget(): void {
  if (requested) return
  requested = true
  void Promise.resolve()
    .then(() => getPlatform().system.memoryInfo())
    .then(({ totalBytes }) => {
      if (!(totalBytes > 0)) return
      machineBytes = totalBytes
      setSpectralTileMemoryBudget(share(SPECTRAL_MIN_BYTES))
    })
    .catch(() => { requested = false })
}

export function waveformMemoryBudgetBytes(): number {
  return share(WAVEFORM_MIN_BYTES)
}
