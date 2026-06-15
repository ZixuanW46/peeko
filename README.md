<p align="center">
  <img src="./build/icon.png" width="112" height="112" alt="Peeko logo" />
</p>

<h1 align="center">Peeko</h1>

<p align="center">
  <strong>Keep working. Keep half-watching.</strong>
</p>

<p align="center">
  An advanced picture-in-picture video player for macOS, with global shortcuts for picture, sound, and click-through.
</p>

<p align="center">
  <a href="#english">English</a>
  ·
  <a href="#中文">中文</a>
  ·
  <a href="https://peeko.zx-will.com">Website</a>
  ·
  <a href="https://github.com/ZixuanW46/peeko/releases/latest">Download</a>
  ·
  <a href="https://github.com/ZixuanW46/peeko/releases">Releases</a>
</p>

<p align="center">
  <img alt="macOS Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-TypeScript-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" />
  <img alt="Updates" src="https://img.shields.io/badge/updates-GitHub%20Releases-24292F?style=flat-square&logo=github&logoColor=white" />
</p>

## English

Peeko is an advanced picture-in-picture video player for macOS. Open a web video page, keep it live in the corner, then use global shortcuts to control the picture, sound, and mouse clicks separately: hide the picture while audio keeps playing, mute without hiding, click through to the app underneath, or hold Peek to bring the window back only while the keys are down.

It is built for the things you're half-watching: keep working, keep listening, and peek when it matters.

Peeko is not a content platform and does not host video. It is a local browser shell for pages you choose to open.

### Highlights

| Feature                             | What it does                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Advanced picture-in-picture         | Keeps a web video live in the corner, above normal apps and full-screen spaces.                            |
| Separate picture, sound, and clicks | Hide the picture, mute the audio, or let mouse clicks pass through independently.                          |
| Hold to Peek                        | The signature move: show the picture only while the shortcut is held, then release and it is gone again.   |
| Vanish in a keystroke               | Hide, mute, and pause in one move when the whole player needs to disappear.                                |
| Browser / Cinema Mode               | Browse normally, then switch to a focused viewing surface.                                                 |
| Global shortcuts                    | Control hide, peek, play, mute, mode switching, click-through, and fullscreen without touching the window. |
| Dock + menu bar                     | Shows in the Dock by default, with a menu bar control always available.                                    |
| User-controlled updates             | Checks GitHub Releases and downloads updates only after you confirm.                                       |

### Default Shortcuts

All shortcuts can be changed in Settings.

| Shortcut                      | Action                                             |
| ----------------------------- | -------------------------------------------------- |
| `Control + Z`                 | Hide / restore picture while audio continues.      |
| `Control + X`                 | Hold to peek.                                      |
| `Control + C`                 | Vanish: hide, mute, and pause.                     |
| `Control + Q`                 | Quit Peeko globally.                               |
| `Command + Q`                 | Quit Peeko when Peeko is focused (macOS standard). |
| `Control + P`                 | Play / pause.                                      |
| `Control + M`                 | Mute toggle.                                       |
| `Control + Up / Down`         | Raise / lower video volume by 10%.                 |
| `Control + B`                 | Browser / Cinema Mode.                             |
| `Control + T`                 | Click-through toggle.                              |
| `Control + Enter`             | Video fullscreen.                                  |
| `Control + Shift + Up / Down` | Raise / lower click-through opacity by 5%.         |
| `Control + Left / Right`      | Seek backward / forward by 10 seconds.             |

### Download

Peeko is currently built for Apple Silicon Macs.

- Website: [peeko.zx-will.com](https://peeko.zx-will.com)
- Latest release: [github.com/ZixuanW46/peeko/releases/latest](https://github.com/ZixuanW46/peeko/releases/latest)
- All releases: [github.com/ZixuanW46/peeko/releases](https://github.com/ZixuanW46/peeko/releases)

The first update-enabled public version is `0.1.0`. Older local test builds cannot receive automatic updates retroactively and need to be replaced manually.

### Permissions

Peeko asks for macOS Accessibility permission so it can listen for global key-down and key-up events, which powers hold-to-peek. It does not record the screen or audio. Website sessions and cookies stay inside Peeko's local Electron browser session.

### Built With

- [Electron](https://www.electronjs.org/) + [TypeScript](https://www.typescriptlang.org/) for the macOS desktop app.
- [electron-vite](https://electron-vite.org/) / [Vite](https://vite.dev/) for the build pipeline.
- [uiohook-napi](https://github.com/SnosMe/uiohook-napi) for global key-down / key-up events.
- [electron-liquid-glass](https://www.npmjs.com/package/electron-liquid-glass) for macOS Liquid Glass surfaces where available.
- [electron-updater](https://www.electron.build/auto-update) + GitHub Releases for user-controlled app updates.
- [electron-builder](https://www.electron.build/) for macOS packaging.
- Frontend website design and logo design were shaped with Claude Design.
- Software development was assisted by Claude Code Fable 5 and Codex GPT-5.5.

### License

Peeko is released under the [MIT License](./LICENSE).

## 中文

Peeko 是一个自带全局快捷键的 macOS 高级画中画视频播放器。打开网页视频，把它放在角落，然后把画面、音频和鼠标点击分开控制：可以只隐藏画面让声音继续、只静音让画面继续、让鼠标直接点到下面的应用，也可以按住 Peek 临时看一眼，松开后马上消失。

它为那些你“半看着”的内容而做：继续工作，继续听，重要时再看一眼。

Peeko 不是内容平台，也不托管视频。它只是一个本地浏览器外壳，打开什么页面由用户自己决定。

### 主要能力

| 功能                     | 说明                                                       |
| ------------------------ | ---------------------------------------------------------- |
| 高级画中画               | 把网页视频放在角落，并浮在普通应用和全屏空间之上。         |
| 画面、音频、点击分开控制 | 可以单独隐藏画面、静音音频，或让鼠标点击穿透到下面的应用。 |
| 按住 Peek                | 最有意思的功能：按住快捷键才显示画面，松开后马上消失。     |
| Vanish                   | 需要彻底消失时，一次快捷键隐藏、静音并暂停。               |
| 浏览 / 观影模式          | 先正常浏览网页，再切换到专注的视频视图。                   |
| 全局快捷键               | 不摸窗口也能隐藏、Peek、播放、静音、切换模式、穿透和全屏。 |
| Dock + 菜单栏            | 默认显示在 Dock 中，同时保留菜单栏控制入口。               |
| 用户确认更新             | 通过 GitHub Releases 检查更新，用户确认后才下载。          |

### 默认快捷键

所有快捷键都可以在设置里修改。

| 快捷键                        | 行为                                     |
| ----------------------------- | ---------------------------------------- |
| `Control + Z`                 | 隐藏 / 恢复画面，音频继续。              |
| `Control + X`                 | 按住窥视。                               |
| `Control + C`                 | Vanish：隐藏、静音并暂停。               |
| `Control + Q`                 | 全局退出 Peeko。                         |
| `Command + Q`                 | Peeko 被选中时退出 Peeko（macOS 标准）。 |
| `Control + P`                 | 播放 / 暂停。                            |
| `Control + M`                 | 静音切换。                               |
| `Control + Up / Down`         | 音量增加 / 降低 10%。                    |
| `Control + B`                 | 浏览 / 观影模式切换。                    |
| `Control + T`                 | 鼠标穿透切换。                           |
| `Control + Enter`             | 视频全屏。                               |
| `Control + Shift + Up / Down` | 穿透不透明度增加 / 降低 5%。             |
| `Control + Left / Right`      | 快退 / 快进 10 秒。                      |

### 下载

Peeko 当前面向 Apple Silicon Mac。

- 官网：[peeko.zx-will.com](https://peeko.zx-will.com)
- 最新版本：[github.com/ZixuanW46/peeko/releases/latest](https://github.com/ZixuanW46/peeko/releases/latest)
- 全部版本：[github.com/ZixuanW46/peeko/releases](https://github.com/ZixuanW46/peeko/releases)

首个带应用内更新能力的公开版本是 `0.1.0`。更早的本地测试包不能事后获得自动更新能力，需要手动安装新版。

### 权限

Peeko 会请求 macOS 辅助功能权限，用于监听全局按下 / 松开事件，这是按住窥视能力的基础。它不会录屏，也不会录音。网页登录态和 Cookie 保存在 Peeko 本地的 Electron 浏览器会话里。

### 技术栈

- [Electron](https://www.electronjs.org/) + [TypeScript](https://www.typescriptlang.org/) 构建 macOS 桌面应用。
- [electron-vite](https://electron-vite.org/) / [Vite](https://vite.dev/) 负责构建流程。
- [uiohook-napi](https://github.com/SnosMe/uiohook-napi) 负责全局按下 / 松开事件。
- [electron-liquid-glass](https://www.npmjs.com/package/electron-liquid-glass) 在可用系统上提供 macOS Liquid Glass 表面。
- [electron-updater](https://www.electron.build/auto-update) + GitHub Releases 提供用户确认式应用更新。
- [electron-builder](https://www.electron.build/) 负责 macOS 打包。
- 前端网页设计和 Logo 设计由 Claude Design 辅助完成。
- 软件开发由 Claude Code Fable 5 和 Codex GPT-5.5 辅助完成。

### 许可证

Peeko 使用 [MIT License](./LICENSE) 发布。
