import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// ============================================================
// 三端构建：main（含原生模块 uiohook-napi，须外部化）
//          preload（page=注入目标网页 / ui=本地界面桥）
//          renderer（settings 设置窗；控制条为页内注入，无独立页面）
// ============================================================
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          page: resolve(__dirname, 'src/preload/page.ts'),
          ui: resolve(__dirname, 'src/preload/ui.ts'),
          tray: resolve(__dirname, 'src/preload/tray.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          onboarding: resolve(__dirname, 'src/renderer/onboarding/index.html'),
          tray: resolve(__dirname, 'src/renderer/tray/index.html')
        }
      }
    }
  }
})
