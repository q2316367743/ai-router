# 01 - 项目初始化（参考 mistrelle）

> 日期：2026-09-15。本文记录 ai-router 工程骨架的来源、结构与约定，是后续所有功能文档的前置参考。

## 来源

以 [mistrelle](../../../mistrelle)（同为 electron-vite 的成熟项目）为蓝本，剥离其业务设施后的「工程骨架 + 数据库基线」：

- **保留**：TDesign + 图标、UnoCSS（tdesign token 映射）、unplugin 自动导入、Pinia、Vue Router、Less、drizzle-orm + better-sqlite3、ESLint flat config、electron-builder 打包配置、AGENTS.md 工程规范。
- **未带入**（需要时再从 mistrelle 参考）：express 本地事件服务、托盘 / macOS Dock、buddy 伙伴窗口（preload 双入口）、serialport / sharp / koffi / tiptap / monaco / echarts 等业务依赖。

## 目录结构

```
src/
├── common/types/          # 三端共享数据契约（@common/*）
├── main/
│   ├── index.ts           # 生命周期编排：单实例锁 → registerIpc → initDb → createMainWindow
│   └── src/
│       ├── app/mainWindow.ts   # 主窗口（三平台 Fluent 标题栏：darwin hiddenInset+vibrancy / win acrylic / linux overlay）
│       ├── db/                 # client.ts 单例 + schema/ 表结构 + dbIpc.ts
│       └── registerIpc.ts      # IPC 聚合注册点
├── preload/
│   ├── index.ts           # contextBridge 组装（window.electron + window.preload）
│   └── src/modules/<域>/  # 渲染层桥（ipcRenderer.invoke('<域>:<动作>')）
└── renderer/
    ├── index.html         # 指向 /src/windows/main/main.ts（多窗口模式：每窗口一个目录）
    └── src/
        ├── vite-env.d.ts       # Window.preload 契约声明（与 preload 桥同步维护）
        ├── assets/style/global.less
        └── windows/main/       # 主窗口：main.ts / App.vue / router.ts / store/ / pages/
```

## 关键约定与事实

1. **别名**：`$`(main/src)、`~`(preload/src)、`@`(renderer/src)、`@common`(src/common)、`@resources`(resources)；tsconfig.node.json / tsconfig.web.json 与 electron.vite.config.ts 三处保持同步。
2. **自动导入**：renderer 中 vue / @vueuse/core / vue-router 的 API 与 TDesign 组件、插件类 API（DialogPlugin 等）均免 import；生成物 `src/renderer/auto-imports.d.ts`、`components.d.ts`、根目录 `.eslintrc-auto-import.json` 由 vite 插件产出（eslintrc 由 AutoImport 的 `eslintrc.enabled` 生成）。**新 clone 后需跑一次 `yarn dev` 或 `npx electron-vite build` 生成这三个文件，否则 typecheck / lint 报错。**
3. **数据库**：DB 文件 `~/.ai-router/db/ai-router.db`（WAL + 外键）；表结构写在 `src/main/src/db/schema/`，`npx drizzle-kit generate` 输出到 `resources/drizzle/`（electron-vite main publicDir，打包时 asarUnpack）；运行时 `client.ts` 经 `__dirname/../../resources/drizzle` 解析并 `migrate()`，迁移目录不存在时跳过（防空库崩溃）。
4. **跨进程链路示例（db:ping）**：`window.preload.db.ping()` → `preload/src/modules/db/db.ts`（`ipcRenderer.invoke('db:ping')`）→ `main/src/db/dbIpc.ts`（`db().run(sql`SELECT 1`)`）。新域照此四步：桥 → 组装 → 契约类型 → main handler 注册。
5. **窗口标题栏**：无边框（hiddenInset / titleBarOverlay），`App.vue` 顶部有 `.window-drag-region`（38px 拖拽区），业务页面布局需避开顶部 38px。
6. **深浅色**：UnoCSS `dark: 'class'`（html.dark）+ TDesign `theme-mode` 属性，统一经 `useAppStore().toggleTheme()` 切换。
7. **dev 端口**：7744（mistrelle 为 7743，错开便于同开）。
8. **脚手架引导**：首次初始化执行过 `npx electron-vite build` + `npx drizzle-kit generate`（空 schema 初始迁移）；日常开发按 AGENTS.md RL-07 只跑 typecheck。
