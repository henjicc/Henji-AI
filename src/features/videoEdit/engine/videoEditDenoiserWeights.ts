/** 本 Worker 里路径追踪降噪权重的地址（主窗口准备好后交来）；没有时路径追踪不降噪。 */
let weightsUrl: string | undefined

export function setVideoEditDenoiserWeights(url: string): void { weightsUrl = url }
export function videoEditDenoiserWeightsUrl(): string | undefined { return weightsUrl }
