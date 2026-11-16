import { defineConfig } from 'vite';

export default defineConfig({
  base: '/atlas/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          search: ['fuse.js', 'graphology']
        }
      }
    }
  },
  server: {
    port: 5173,
    host: true
  }
});
