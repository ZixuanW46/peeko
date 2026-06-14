/**
 * [INPUT]: 依赖 electron 的 app.dock，依赖 ./store 的 showInDock 设置
 * [OUTPUT]: 对外提供 applyDockVisibility()/setDockVisibility()
 * [POS]: main 的 Dock 可见性门闩——附件型与普通 Dock 应用之间的唯一切换点
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app } from 'electron'
import { store } from './store'

export function applyDockVisibility(): boolean {
  const show = store.data.showInDock
  if (process.platform !== 'darwin' || !app.dock) return false
  if (show) void app.dock.show()
  else app.dock.hide()
  return show
}

export function setDockVisibility(show: boolean): boolean {
  store.patch({ showInDock: show })
  return applyDockVisibility()
}
