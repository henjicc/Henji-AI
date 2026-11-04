/** poisson-disk-sampling 2.x（MIT）用到的那部分接口；包本身不带类型。 */
declare module 'poisson-disk-sampling' {
  interface PoissonDiskSamplingOptions {
    shape: number[]
    minDistance: number
    maxDistance?: number
    tries?: number
  }

  export default class PoissonDiskSampling {
    constructor(options: PoissonDiskSamplingOptions, rng?: () => number)
    addPoint(point: number[]): number[] | null
    fill(): number[][]
  }
}
