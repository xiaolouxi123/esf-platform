import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 打包后 Electron 用 file:// 加载 dist/index.html，
  // 必须用相对路径，否则 /assets/... 会被解析到磁盘根目录而白屏
  base: './',
  plugins: [react()],
})
