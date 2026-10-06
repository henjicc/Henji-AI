import type { LocalizedText, LocalModelId } from '../../../../src/platform/contracts/localModels'
import type { DownloadRegion } from '../download/sourceSelector'

/*
 * 本地模型清单（任务 4.11）：每个文件的大小与 SHA-256 写死在这里，按官方文件实际计算
 * （2026-10-06 从官方源下载核对，各 ModelScope 镜像同名文件哈希一致，记录见任务文件 4.11）。
 * 任何源下载到的文件都按这里校验，镜像被替换或损坏会被拒绝。
 *
 * 下载源按区域分组，同一区域内按顺序尝试：
 * - 国内首选我们自己的 ModelScope 仓库（OWN_MODELSCOPE_REPO，上传前不存在，探测到 404 会自动换下一个）；
 *   其次是现有的第三方 ModelScope 镜像（个人仓库可能失效，所以只作备用）。
 * - 国外用官方 Hugging Face / GitHub。
 *
 * 新增模型：在 `src/platform/contracts/localModels.ts` 的 LOCAL_MODEL_IDS 登记 ID，再在这里补一条。
 */

/** 我们自己的 ModelScope 模型仓库（用户上传后生效）。目录结构见任务文件 4.11 的上传清单。 */
export const OWN_MODELSCOPE_REPO = 'henjicc/henji-ai-local-models'

export function modelScopeUrl(repo: string, file: string): string {
  return `https://www.modelscope.cn/models/${repo}/resolve/master/${file}`
}

function ownUrl(file: string): string {
  return modelScopeUrl(OWN_MODELSCOPE_REPO, file)
}

function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`
}

export interface LocalModelSource {
  region: DownloadRegion
  /** 日志里区分来源用（不展示给用户）。 */
  label: string
  url: string
}

export interface LocalModelFileSpec {
  /** 存到本地的文件名。 */
  name: string
  role: 'model'
  sizeBytes: number
  sha256: string
  sources: readonly LocalModelSource[]
}

export interface LocalModelLicense {
  /** SPDX 简称。 */
  spdx: string
  url: string
}

export interface LocalModelSpec {
  id: LocalModelId
  title: LocalizedText
  purpose: LocalizedText
  /** 本地文件夹名（按作品目录的分类文件夹语言取用）。 */
  folderName: LocalizedText
  /** 原始项目主页（写进说明文件）。 */
  homepage: string
  license: LocalModelLicense
  /** `pending`：还没有可下载的文件（需要另行导出），列表里显示为“暂不可下载”。 */
  availability: 'available' | 'pending'
  files: readonly LocalModelFileSpec[]
}

/** 自动选源时的探测地址：只看连通性，任何 HTTP 响应都算可达。 */
export const LOCAL_MODEL_SOURCE_PROBES: Readonly<Record<DownloadRegion, string>> = {
  domestic: 'https://www.modelscope.cn/',
  global: 'https://huggingface.co/',
}

export const LOCAL_MODEL_MANIFEST: readonly LocalModelSpec[] = [
  {
    id: 'face_detection_yunet',
    title: { zh: '人脸检测 YuNet', en: 'Face Detection (YuNet)' },
    purpose: { zh: '找出画面中的人脸，用于人脸打码与人脸区域', en: 'Finds faces for face blur and face regions' },
    folderName: { zh: '人脸检测 YuNet', en: 'Face Detection YuNet' },
    homepage: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    license: { spdx: 'MIT', url: 'https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE' },
    availability: 'available',
    files: [{
      name: 'face_detection_yunet_2023mar.onnx',
      role: 'model',
      sizeBytes: 232_589,
      sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('face_detection_yunet/face_detection_yunet_2023mar.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('FlynnDu/novaber-privacy-redaction-yunet', 'face_detection_yunet_2023mar.onnx') },
        { region: 'global', label: 'huggingface-opencv', url: huggingFaceUrl('opencv/face_detection_yunet', 'face_detection_yunet_2023mar.onnx') },
        { region: 'global', label: 'github-opencv-zoo', url: 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' },
      ],
    }],
  },
  {
    id: 'person_matting_rvm',
    title: { zh: '人物抠像 RVM', en: 'Person Matting (RVM)' },
    purpose: { zh: '把人物从视频背景中抠出，边缘稳定不闪，用于抠像与背景虚化', en: 'Separates people from video backgrounds for matting and background blur' },
    folderName: { zh: '人物抠像 RVM', en: 'Person Matting RVM' },
    homepage: 'https://github.com/PeterL1n/RobustVideoMatting',
    license: { spdx: 'GPL-3.0', url: 'https://github.com/PeterL1n/RobustVideoMatting/blob/master/LICENSE' },
    availability: 'available',
    files: [{
      name: 'rvm_mobilenetv3_fp16.onnx',
      role: 'model',
      sizeBytes: 7_503_483,
      sha256: '6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('person_matting_rvm/rvm_mobilenetv3_fp16.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('ymfjly/RVM_GUI_DependentModels', 'rvm_mobilenetv3_fp16.onnx') },
        { region: 'global', label: 'github-release', url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp16.onnx' },
      ],
    }],
  },
  {
    id: 'selfie_segmentation',
    title: { zh: '快速人像分割 MediaPipe', en: 'Fast Selfie Segmentation (MediaPipe)' },
    purpose: { zh: '快速区分人物与背景，用于预览和配置较低的电脑', en: 'Quick person/background split for previews and low-end machines' },
    folderName: { zh: '快速人像分割 MediaPipe', en: 'Selfie Segmentation MediaPipe' },
    homepage: 'https://huggingface.co/onnx-community/mediapipe_selfie_segmentation',
    license: { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    availability: 'available',
    files: [{
      name: 'mediapipe_selfie_segmentation_fp16.onnx',
      role: 'model',
      sizeBytes: 251_097,
      sha256: '3b2a53a26b6e7c00b5e2415443e45dfa8c66c62bd496f7f2ee7dcf9ce47dea4f',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('selfie_segmentation/mediapipe_selfie_segmentation_fp16.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('onnx-community/mediapipe_selfie_segmentation', 'onnx/model_fp16.onnx') },
        { region: 'global', label: 'huggingface-onnx-community', url: huggingFaceUrl('onnx-community/mediapipe_selfie_segmentation', 'onnx/model_fp16.onnx') },
      ],
    }],
  },
  {
    id: 'text_detection_ppocr',
    title: { zh: '文字检测 PP-OCR', en: 'Text Detection (PP-OCR)' },
    purpose: { zh: '找出画面中的文字区域，用于擦字幕与文字打码', en: 'Finds text regions for subtitle removal and text blur' },
    folderName: { zh: '文字检测 PP-OCR', en: 'Text Detection PP-OCR' },
    // PaddleOCR 官方只发布 Paddle 格式；ONNX 由 RapidOCR 项目转换发布（Apache-2.0），其主仓库在 ModelScope。
    homepage: 'https://github.com/RapidAI/RapidOCR',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/RapidAI/RapidOCR/blob/main/LICENSE' },
    availability: 'available',
    files: [{
      name: 'ch_PP-OCRv4_det_mobile.onnx',
      role: 'model',
      sizeBytes: 4_745_517,
      sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('text_detection_ppocr/ch_PP-OCRv4_det_mobile.onnx') },
        { region: 'domestic', label: 'modelscope-rapidocr', url: modelScopeUrl('RapidAI/RapidOCR', 'onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx') },
        { region: 'global', label: 'huggingface-rapidocr', url: huggingFaceUrl('SWHL/RapidOCR', 'PP-OCRv4/ch_PP-OCRv4_det_infer.onnx') },
      ],
    }],
  },
  {
    id: 'object_tracking_vittrack',
    title: { zh: '物体框跟踪 VitTrack', en: 'Box Tracking (VitTrack)' },
    purpose: { zh: '框选一个物体后逐帧跟随它的位置，用于让文字、贴纸或效果跟着物体走', en: 'Follows a boxed object frame by frame so text, stickers or effects can move with it' },
    folderName: { zh: '物体框跟踪 VitTrack', en: 'Box Tracking VitTrack' },
    homepage: 'https://github.com/opencv/opencv_zoo/tree/main/models/object_tracking_vittrack',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/opencv/opencv_zoo/blob/main/models/object_tracking_vittrack/LICENSE' },
    availability: 'available',
    files: [{
      name: 'object_tracking_vittrack_2023sep.onnx',
      role: 'model',
      sizeBytes: 714_726,
      sha256: '2990f0b7cd44d92afa48cd97db6de7be113fc1d9594fddb74e2725c10478e91d',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx') },
        { region: 'global', label: 'huggingface-opencv', url: huggingFaceUrl('opencv/object_tracking_vittrack', 'object_tracking_vittrack_2023sep.onnx') },
        { region: 'global', label: 'github-opencv-zoo', url: 'https://github.com/opencv/opencv_zoo/raw/main/models/object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx' },
      ],
    }],
  },
  {
    id: 'object_tracking_efficienttam',
    title: { zh: '任意物体跟踪 EfficientTAM', en: 'Object Tracking (EfficientTAM)' },
    purpose: { zh: '点选或框选任意物体后整段跟踪', en: 'Tracks any clicked or boxed object through a clip' },
    folderName: { zh: '任意物体跟踪 EfficientTAM', en: 'Object Tracking EfficientTAM' },
    homepage: 'https://github.com/yformer/EfficientTAM',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/yformer/EfficientTAM/blob/main/LICENSE' },
    // 官方没有 ONNX，需要自行导出（任务 4.10d）；导出并上传到我们的仓库后在这里补文件与哈希。
    availability: 'pending',
    files: [],
  },
]

export function findLocalModelSpec(id: LocalModelId): LocalModelSpec {
  const spec = LOCAL_MODEL_MANIFEST.find((item) => item.id === id)
  if (!spec) throw new Error(`本地模型清单里没有 ${id}`)
  return spec
}

export function localModelSizeBytes(spec: LocalModelSpec): number {
  return spec.files.reduce((sum, file) => sum + file.sizeBytes, 0)
}
