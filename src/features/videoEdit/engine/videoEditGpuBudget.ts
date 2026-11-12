/**
 * 剪辑渲染各项缓存的预算，按本机专用显存与系统内存取值。全部只作淘汰目标与降画质阈值：超出时先淘汰不在当前帧的内容，
 * 当前帧需要的一律保留，不因预算让某一帧报错。
 *
 * 字节预算都是显存驻留：图片与文字纹理、解码图片（上传前的位图由浏览器放在 GPU 侧）、代码输入画面、代码目标与字形、
 * 三维工作集、跳转常驻画面，节目帧缓存存的也是复制到合成设备上的 GPU 画面（`VideoEditGpuFrame`）。渲染侧各项合计取专用显存
 * 的一半，按 `RESIDENT_SHARES` 的比例分；原生解码服务另取 40%（`native/video-decoder/src/budget.rs`），留一成给系统与图片编辑器。拖动时保留的闲置读取器与声音来源主要占系统内存，按内存取。
 * 读不到显存按 8GiB、读不到内存按 16GiB；专用显存不足 2GiB 的多是核显（实际用共享内存），渲染侧合计按系统内存的 1/4。
 */
export interface VideoEditDeviceMemory {
  /** 显卡专用显存（硬件记录里的 dedicatedMemoryMiB 换算成字节）。 */
  dedicatedVideoMemoryBytes?: number
  /** 系统物理内存。 */
  systemMemoryBytes?: number
}

export interface VideoEditGpuBudget {
  /** 上传的图片与文字纹理、解码好的图片、代码输入的定格画面。 */
  imageBytes: number
  /** 网页、视频输入与嵌套画面的历史和前视；当前帧必需输入不受此值限制。 */
  inputBytes: number
  /** 代码效果的闲置目标池与字形纹理；当前帧的生成器目标不受此限。 */
  codeResidentBytes: number
  /** 三维空间推近升档的工作集：卡片材料面、景深、组画面目标与 three 内部目标之和。一倍栅格不受此限。 */
  spatialBytes: number
  /** 跳转先出的常驻画面（节目监视器）。 */
  jumpPreviewBytes: number
  /** 节目解码帧缓存的默认预算。 */
  frameCacheBytes: number
  /** 浏览器回退路径拖动时保留的闲置读取器；原生会话由服务端显存账本保留，不用此数。 */
  idleScrubRenderers: number
  /** 拖动混音时保留的闲置声音来源（含嵌套序列的声音渲染器）。 */
  idleAudioSources: number
}

const GIB = 1024 ** 3
const UNKNOWN_VRAM = 8 * GIB, UNKNOWN_MEMORY = 16 * GIB, SHARED_VRAM_BELOW = 2 * GIB
/** 渲染侧显存（专用显存的一半）在各项之间的比例。 */
const RESIDENT_SHARES = { frameCacheBytes: 8, spatialBytes: 4, imageBytes: 3, inputBytes: 1.5, codeResidentBytes: 1.5, jumpPreviewBytes: 1 } as const

const positive = (value: number | undefined): number | undefined => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined

export function videoEditGpuBudgetFor(device: VideoEditDeviceMemory): VideoEditGpuBudget {
  const memory = positive(device.systemMemoryBytes) ?? UNKNOWN_MEMORY
  const dedicated = positive(device.dedicatedVideoMemoryBytes) ?? UNKNOWN_VRAM
  const total = dedicated < SHARED_VRAM_BELOW ? memory / 4 : dedicated / 2, weight = Object.values(RESIDENT_SHARES).reduce((sum, value) => sum + value, 0)
  const resident = Object.fromEntries(Object.entries(RESIDENT_SHARES).map(([key, share]) => [key, Math.floor(total * share / weight)])) as Record<keyof typeof RESIDENT_SHARES, number>
  const gib = memory / GIB
  return { ...resident, idleScrubRenderers: Math.min(16, Math.max(4, Math.round(gib / 4))), idleAudioSources: Math.min(32, Math.max(8, Math.round(gib / 4))) }
}

const DEFAULT_BUDGET = videoEditGpuBudgetFor({})
let current: VideoEditGpuBudget = DEFAULT_BUDGET
let textureDimension = 8192

/** 当前生效的预算（同一 Worker 内的所有渲染器共用）。 */
export function videoEditGpuBudget(): VideoEditGpuBudget { return current }

/** 三维空间推近升档的工作集预算（随 `configureVideoEditGpuBudget` 更新的实时绑定）。 */
export let VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES = DEFAULT_BUDGET.spatialBytes

/** 渲染器拿到设备信息后调用一次；之后新建的缓存按新预算取值。 */
export function configureVideoEditGpuBudget(device: VideoEditDeviceMemory): void {
  current = videoEditGpuBudgetFor(device)
  VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES = current.spatialBytes
}

/** 单张纹理的边长上限：合成设备申请到的 `maxTextureDimension2D`；设备就绪前按 WebGPU 保证的 8192。 */
export function videoEditMaxTextureDimension(): number { return textureDimension }
export function setVideoEditMaxTextureDimension(value: number | undefined): void {
  if (value !== undefined && Number.isSafeInteger(value) && value >= 8192) textureDimension = value
}

/** 受管 three 的颜色、四样本颜色与深度目标；宿主借给它的输出纹理另计。 */
export function videoEditThreeTargetBytes(width: number, height: number, backend: 'webgpu' | 'webgl'): number {
  return width * height * (backend === 'webgpu' ? 8 * 6 + 4 * 4 : 4 * 6 + 4 * 4)
}
