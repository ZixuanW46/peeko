/**
 * [INPUT]: 依赖 electron 的 contextBridge/ipcRenderer
 * [OUTPUT]: 对外提供 window.peeko 桥——settings:get / set-shortcut / remove-favorite
 * [POS]: preload 的本地 UI 侧，与 main/ipc.ts 设置通道对偶
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('peeko', {
  getLanguage: () => ipcRenderer.invoke('i18n:get-language'),
  setLanguagePreference: (preference: string) =>
    ipcRenderer.invoke('settings:set-language', preference),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  probeShortcut: (action: string, accelerator: string) =>
    ipcRenderer.invoke('settings:probe-shortcut', action, accelerator),
  setShortcut: (action: string, accelerator: string) =>
    ipcRenderer.invoke('settings:set-shortcut', action, accelerator),
  beginShortcutRecording: () => ipcRenderer.invoke('settings:begin-shortcut-recording'),
  endShortcutRecording: () => ipcRenderer.invoke('settings:end-shortcut-recording'),
  resetShortcuts: () => ipcRenderer.invoke('settings:reset-shortcuts'),
  setAutoCinema: (on: boolean) => ipcRenderer.invoke('settings:set-auto-cinema', on),
  setPassthroughOpacity: (v: number) => ipcRenderer.invoke('settings:set-passthrough-opacity', v),
  setShowInDock: (show: boolean) => ipcRenderer.invoke('settings:set-show-in-dock', show),
  openSettings: () => ipcRenderer.send('settings:open'),
  copyDiagnostics: () => ipcRenderer.invoke('settings:copy-diagnostics'),
  clearBrowserSession: () => ipcRenderer.invoke('settings:clear-browser-session'),
  clearFavorites: () => ipcRenderer.invoke('settings:clear-favorites'),
  resetPreferences: () => ipcRenderer.invoke('settings:reset-preferences'),
  removeFavorite: (url: string) => ipcRenderer.invoke('settings:remove-favorite', url),
  renameFavorite: (url: string, name: string) =>
    ipcRenderer.invoke('settings:rename-favorite', url, name),
  replayIntro: () => ipcRenderer.send('settings:replay-intro'),
  // 引导蒙版页专用
  onboardingDone: () => ipcRenderer.send('onboarding:done'),
  onboardingClose: () => ipcRenderer.send('onboarding:close'),
  quitPeeko: () => ipcRenderer.send('onboarding:quit'),
  prepDemo: (target: 'NORMAL' | 'HIDDEN') => ipcRenderer.send('onboarding:prep', target),
  floatRect: () => ipcRenderer.invoke('onboarding:float-rect'),
  setFullscreenDemo: (on: boolean) => ipcRenderer.send('onboarding:fullscreen-demo', on),
  setIgnoreMouse: (on: boolean) => ipcRenderer.send('onboarding:ignore-mouse', on),
  restoreOnboarding: () => ipcRenderer.invoke('onboarding:restore'),
  startRuntime: () => ipcRenderer.invoke('onboarding:start-runtime'),
  setMode: (mode: string, demoGeometry?: boolean) =>
    ipcRenderer.invoke('onboarding:set-mode', mode, demoGeometry),
  shouldRunIntro: () => ipcRenderer.invoke('onboarding:should-run-intro'),
  shortcutHealth: () => ipcRenderer.invoke('onboarding:shortcut-health'),
  applyRecommendedShortcuts: () => ipcRenderer.invoke('onboarding:apply-recommended-shortcuts'),
  axTrusted: () => ipcRenderer.invoke('onboarding:ax-trusted'),
  openAxSettings: () => ipcRenderer.send('onboarding:open-ax'),
  onLanguage: (cb: (language: unknown) => void) =>
    ipcRenderer.on('i18n:language', (_e, language) => cb(language)),
  onUpdateState: (cb: (state: unknown) => void) =>
    ipcRenderer.on('updates:state', (_e, state) => cb(state)),
  onDemoKey: (cb: (payload: { action: string; mode: string }) => void) =>
    ipcRenderer.on('demo:key', (_e, payload) => cb(payload))
})
