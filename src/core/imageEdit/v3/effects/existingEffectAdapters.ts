import {
  DIFFUSION_PARAMS_SCHEMA_VERSION,
  parseDiffusionOperationParams,
} from '../../diffusionParams';
import {
  compileDiffusionRecipe,
  DIFFUSION_RECIPE_VERSION,
  type CompileDiffusionRecipeOptions,
  type DiffusionRecipe,
} from '../../diffusionRecipe';
import type { DiffusionOperationParams } from '../../types';
import {
  parseVgpuGlowOperationParams,
  type VgpuGlowOperationParams,
} from '../../vgpuGlowParams';
import {
  compileVgpuGlowRecipe,
  VGPU_GLOW_RECIPE_VERSION,
  type CompileVgpuGlowRecipeOptions,
  type VgpuGlowRecipe,
} from '../../vgpuGlowRecipe';
import type { CpuReferenceKernelContract } from './contracts';

export interface ExistingEffectRecipeAdapter<
  TParameters extends object,
  TOptions extends object,
  TRecipe extends object,
> {
  readonly id: string;
  readonly nodeVersion: number;
  readonly parameterSchemaVersion: number;
  readonly recipeVersion: number;
  readonly contract: CpuReferenceKernelContract;
  readonly implementation: 'existing-recipe';
  readonly parseParameters: (value: unknown) => TParameters;
  readonly compileRecipe: (parameters: TParameters, options: TOptions) => TRecipe;
}

const DIFFUSION_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.diffusion',
  version: 4,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

const VGPU_GLOW_CONTRACT: CpuReferenceKernelContract = {
  id: 'effect.vgpu-glow',
  version: 4,
  inputColorDomain: 'linear-light',
  outputColorDomain: 'linear-light',
  alpha: 'premultiplied',
  precision: 'float32',
  maskMix: 'source-to-processed',
};

/** 复用稳定的 diffusion schema v4 与 recipe；V3 不另写一套散射数学。 */
export const DIFFUSION_V4_RECIPE_ADAPTER: ExistingEffectRecipeAdapter<
  DiffusionOperationParams,
  CompileDiffusionRecipeOptions,
  DiffusionRecipe
> = {
  id: 'effect.diffusion',
  nodeVersion: 4,
  parameterSchemaVersion: DIFFUSION_PARAMS_SCHEMA_VERSION,
  recipeVersion: DIFFUSION_RECIPE_VERSION,
  contract: DIFFUSION_CONTRACT,
  implementation: 'existing-recipe',
  parseParameters: parseDiffusionOperationParams,
  compileRecipe: compileDiffusionRecipe,
};

/** 复用稳定的 VGPU Glow schema v4 与光学 recipe；V3 只负责图层求值和调度。 */
export const VGPU_GLOW_V4_RECIPE_ADAPTER: ExistingEffectRecipeAdapter<
  VgpuGlowOperationParams,
  CompileVgpuGlowRecipeOptions,
  VgpuGlowRecipe
> = {
  id: 'effect.vgpu-glow',
  nodeVersion: 4,
  parameterSchemaVersion: 4,
  recipeVersion: VGPU_GLOW_RECIPE_VERSION,
  contract: VGPU_GLOW_CONTRACT,
  implementation: 'existing-recipe',
  parseParameters: parseVgpuGlowOperationParams,
  compileRecipe: compileVgpuGlowRecipe,
};
