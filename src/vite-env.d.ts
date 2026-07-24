/// <reference types="vite/client" />

declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}
