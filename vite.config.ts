import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * SINGLE_FILE=1 时把所有 JS/CSS 内联进一个 HTML，
 * 方便直接发给不装 Node 的人（双击即用）。
 */
const singleFile = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
  base: '/AzurChessMapEditor/',
  build: singleFile ? { outDir: 'dist-single' } : {},
});
