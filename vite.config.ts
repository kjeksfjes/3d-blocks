import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Make @react-three/rapier load the SIMD WASM build (same 0.19.2 API) for a
      // faster solver — no change to physics behaviour. Remove to revert.
      '@dimforge/rapier3d-compat': '@dimforge/rapier3d-simd-compat',
    },
  },
})
