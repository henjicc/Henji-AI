import RAPIER, { init as initialize } from './upstream.mjs';
export * from './upstream.mjs';
let ready;
export function init() {
  return ready ??= initialize().catch(error => {
    ready = undefined;
    throw error;
  });
}
export default { ...RAPIER, init };
