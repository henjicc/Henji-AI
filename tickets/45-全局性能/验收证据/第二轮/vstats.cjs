module.exports = async (page) => page.evaluate(async () => {
  const s = await window.henjiNative.videoFrames.stats(); const n = s.native || {}; const M = 1048576
  return { budget: n.budget && Object.fromEntries(Object.entries(n.budget).map(([k, v]) => [k, /Bytes/.test(k) ? Math.round(v / M) + 'MiB' : v])), gpuLocalMiB: n.gpuLocalMemory && [Math.round(n.gpuLocalMemory.currentUsageBytes / M), Math.round(n.gpuLocalMemory.budgetBytes / M)], nonLocalMiB: n.gpuNonLocalUsageBytes != null ? Math.round(n.gpuNonLocalUsageBytes / M) : null, streams: (n.streams || []).length, running: (n.streams || []).filter(x => x.running).length, wsMiB: Math.round((n.workingSetBytes || 0) / M), unreleased: s.unreleasedImports }
})
