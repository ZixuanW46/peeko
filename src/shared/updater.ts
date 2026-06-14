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

export interface UpdatePrimaryAction {
  command: UpdateCommand | null
  enabled: boolean
  label: string
}

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))
const progressText = (state: UpdateState): string => `${state.progress ?? 0}%`

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
    canCheck: state.phase === 'idle' || state.phase === 'not-available' || state.phase === 'error',
    canDownload: state.phase === 'available',
    canInstall: state.phase === 'downloaded',
    busy
  }
}

export function updatePrimaryAction(
  state: UpdateState,
  language: UpdateLanguage
): UpdatePrimaryAction {
  switch (state.phase) {
    case 'checking':
      return {
        command: null,
        enabled: false,
        label: language === 'zh' ? '检查中' : 'Checking'
      }
    case 'available':
      return {
        command: 'update-download',
        enabled: true,
        label: language === 'zh' ? '下载更新' : 'Download Update'
      }
    case 'downloading':
      return {
        command: null,
        enabled: false,
        label:
          language === 'zh' ? `下载中 ${progressText(state)}` : `Downloading ${progressText(state)}`
      }
    case 'downloaded':
      return {
        command: 'update-install',
        enabled: true,
        label: language === 'zh' ? '重启并安装' : 'Restart & Install'
      }
    case 'error':
      return {
        command: 'update-check',
        enabled: true,
        label: language === 'zh' ? '重新检查' : 'Check Again'
      }
    case 'not-available':
    case 'idle':
      return {
        command: 'update-check',
        enabled: true,
        label: language === 'zh' ? '检查更新' : 'Check for Updates'
      }
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

export function updateErrorText(error: string | null, language: UpdateLanguage): string {
  const raw = error?.trim() ?? ''
  const normalized = raw.toLowerCase()
  if (!raw) return language === 'zh' ? '更新检查失败' : 'Update check failed'
  if (/\b404\b/.test(raw) || normalized.includes('not found')) {
    return language === 'zh' ? '更新源尚未发布' : 'Update feed is not published yet'
  }
  if (
    normalized.includes('enotfound') ||
    normalized.includes('econnrefused') ||
    normalized.includes('etimedout') ||
    normalized.includes('network') ||
    normalized.includes('internet')
  ) {
    return language === 'zh' ? '网络连接失败' : 'Network connection failed'
  }
  return raw
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
        return updateErrorText(state.error, language)
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
      return updateErrorText(state.error, language)
  }
}
