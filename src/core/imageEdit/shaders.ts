import diffusionShaderSource from './shaders/diffusion.wgsl?raw';

/** Renderer 读取的共享 WGSL；Rust 端通过 include_str! 读取同一文件。 */
export const DIFFUSION_SHADER_SOURCE = diffusionShaderSource;

export const DIFFUSION_SHADER_VERSION = 'diffusion-wgsl-v1';
