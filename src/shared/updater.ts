export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  progress: number | null
  error: string | null
  lastCheckedAt: number | null
}

export type UpdateEvent =
  | { type: 'CHECK_START'; at: number }
  | { type: 'UPDATE_AVAILABLE'; version: string; at: number }
  | { type: 'UPDATE_NOT_AVAILABLE'; at: number }
  | { type: 'DOWNLOAD_START' }
  | { type: 'DOWNLOAD_PROGRESS'; progress: number }
  | { type: 'DOWNLOAD_READY'; version?: string }
  | { type: 'ERROR'; error: string }

export type UpdateCommand = 'update-check' | 'update-download' | 'update-install'
export type UpdateLanguage = 'en' | 'zh'

export interface UpdateActionState {
  canCheck: boolean
  canDownload: boolean
  canInstall: boolean
  busy: boolean
}

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

export function createInitialUpdateState(currentVersion: string): UpdateState {
  return {
    phase: 'idle',
    currentVersion,
    latestVersion: null,
    progress: null,
    error: null,
    lastCheckedAt: null
  }
}

export function reduceUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'CHECK_START':
      return { ...state, phase: 'checking', progress: null, error: null, lastCheckedAt: event.at }
    case 'UPDATE_AVAILABLE':
      return {
        ...state,
        phase: 'available',
        latestVersion: event.version,
        progress: null,
        error: null,
        lastCheckedAt: event.at
      }
    case 'UPDATE_NOT_AVAILABLE':
      return {
        ...state,
        phase: 'not-available',
        progress: null,
        error: null,
        lastCheckedAt: event.at
      }
    case 'DOWNLOAD_START':
      return { ...state, phase: 'downloading', progress: 0, error: null }
    case 'DOWNLOAD_PROGRESS':
      return {
        ...state,
        phase: 'downloading',
        progress: clampProgress(event.progress),
        error: null
      }
    case 'DOWNLOAD_READY':
      return {
        ...state,
        phase: 'downloaded',
        latestVersion: event.version ?? state.latestVersion,
        progress: 100,
        error: null
      }
    case 'ERROR':
      return { ...state, phase: 'error', progress: null, error: event.error }
  }
}

export function updateActionState(state: UpdateState): UpdateActionState {
  const busy = state.phase === 'checking' || state.phase === 'downloading'
  return {
    canCheck: !busy,
    canDownload: state.phase === 'available',
    canInstall: state.phase === 'downloaded',
    busy
  }
}

export function updateTrayCommand(state: UpdateState): UpdateCommand {
  if (state.phase === 'downloaded') return 'update-install'
  if (state.phase === 'available') return 'update-download'
  return 'update-check'
}

export function updateTrayEnabled(state: UpdateState): boolean {
  const actions = updateActionState(state)
  return actions.canCheck || actions.canDownload || actions.canInstall
}

export function updateTrayLabel(state: UpdateState, language: UpdateLanguage): string {
  const latest = state.latestVersion ?? ''
  const progress = state.progress ?? 0
  if (language === 'zh') {
    switch (state.phase) {
      case 'checking':
        return '正在检查更新...'
      case 'available':
        return latest ? `更新到 ${latest}...` : '下载更新...'
      case 'downloading':
        return `正在下载 ${progress}%`
      case 'downloaded':
        return '重启以更新'
      case 'not-available':
        return '检查更新...'
      case 'error':
        return '重新检查更新...'
      case 'idle':
        return '检查更新...'
    }
  }
  switch (state.phase) {
    case 'checking':
      return 'Checking for Updates...'
    case 'available':
      return latest ? `Update to ${latest}...` : 'Download Update...'
    case 'downloading':
      return `Downloading ${progress}%`
    case 'downloaded':
      return 'Restart to Update'
    case 'not-available':
      return 'Check for Updates...'
    case 'error':
      return 'Check Again...'
    case 'idle':
      return 'Check for Updates...'
  }
}

export function updateStatusText(state: UpdateState, language: UpdateLanguage): string {
  const latest = state.latestVersion ?? state.currentVersion
  const progress = state.progress ?? 0
  if (language === 'zh') {
    switch (state.phase) {
      case 'idle':
        return `当前版本 ${state.currentVersion}`
      case 'checking':
        return '正在检查更新...'
      case 'available':
        return `Peeko ${latest} 可更新`
      case 'not-available':
        return 'Peeko 已是最新版本'
      case 'downloading':
        return `正在下载更新 ${progress}%`
      case 'downloaded':
        return '更新已下载，重启后安装'
      case 'error':
        return state.error ?? '更新检查失败'
    }
  }
  switch (state.phase) {
    case 'idle':
      return `Current version ${state.currentVersion}`
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return `Peeko ${latest} is available`
    case 'not-available':
      return 'Peeko is up to date'
    case 'downloading':
      return `Downloading update ${progress}%`
    case 'downloaded':
      return 'Update downloaded. Restart to install.'
    case 'error':
      return state.error ?? 'Update check failed'
  }
}

export function updateCheckButtonText(state: UpdateState, language: UpdateLanguage): string {
  if (language === 'zh') return state.phase === 'checking' ? '检查中' : '检查更新'
  return state.phase === 'checking' ? 'Checking' : 'Check for Updates'
}

export function updateDownloadButtonText(state: UpdateState, language: UpdateLanguage): string {
  const progress = state.progress ?? 0
  if (language === 'zh') return state.phase === 'downloading' ? `下载中 ${progress}%` : '下载更新'
  return state.phase === 'downloading' ? `Downloading ${progress}%` : 'Download Update'
}

export function updateInstallButtonText(_state: UpdateState, language: UpdateLanguage): string {
  return language === 'zh' ? '重启并安装' : 'Restart & Install'
}
