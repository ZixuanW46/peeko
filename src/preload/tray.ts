/**
 * [INPUT]: 依赖 electron 的 contextBridge/ipcRenderer
 * [OUTPUT]: 暴露 window.peekoTray——托盘 popover 的状态读取/命令通道/内容高度上报
 * [POS]: preload 的托盘 UI 桥，与 main/tray.ts 的 tray:* IPC 对偶
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('peekoTray', {
  getState: () => ipcRenderer.invoke('tray:get-state'),
  command: (action: string, payload?: unknown) =>
    ipcRenderer.invoke('tray:command', action, payload),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  close: () => ipcRenderer.send('tray:close'),
  // 内容自适应高度：渲染层量好 main 高度回报，main 据此 setBounds 贴合菜单栏
  reportHeight: (h: number) => ipcRenderer.send('tray:height', Math.round(h)),
  onState: (cb: (state: unknown) => void) => ipcRenderer.on('tray:state', (_e, state) => cb(state)),
  onUpdateState: (cb: (state: unknown) => void) =>
    ipcRenderer.on('updates:state', (_e, state) => cb(state))
})
