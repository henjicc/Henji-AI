import diffusionShaderSource from './shaders/diffusion.wgsl?raw';

/** WebGPU Worker 预览与导出共同使用的柔光 WGSL 入口。 */
export const DIFFUSION_SHADER_SOURCE = diffusionShaderSource;

export const DIFFUSION_SHADER_VERSION = 'diffusion-wgsl-v2-multiscale';
