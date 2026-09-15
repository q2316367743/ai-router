# AGENTS.md —— 前端工程约束规范

## 🚫 硬性红线（违反即错）

| 编号  | 规则                                                                           |
|-------|--------------------------------------------------------------------------------|
| RL‑01 | 语言：允许英文思考，但所有对外输出必须使用中文                                 |
| RL‑02 | 根目录洁净：禁止在根目录放置业务代码                                           |
| RL‑03 | 类型安全：禁止使用 `any`；禁止不必要的 `as` 断言                               |
| RL‑04 | UI 强制：所有 UI 元素必须使用 `tdesign`；禁用原生 `alert` / `select`           |
| RL‑05 | 文件长度：vue 文件 ≤ 300 行，ts 文件 ≤ 500 行，超出必须拆分                    |
| RL‑06 | 文档同步：功能实现后，必须将技术文档写入或更新 `docs/` 目录，供后续 AI 参考    |
| RL-07 | 不需要 build，只需要 typecheck，禁止做任何验证/测试，如需验证/测试，请让我来做 |
| RL-08 | 未经我的允许，禁止读取 node_modules 目录下文件                                 |

---

## ⚙️ 编码原则

1. **方案先行**

- 需求模糊时必须提问，不做假设
- 存在多种理解时，全部列出后再确认

2. **简洁至上**

- 用最少代码解决问题
- 自检：「一位资深工程师会觉得这段代码过度设计吗？」

3. **精准修改**

- 只改必须改的部分，保持既有代码风格
- 只清理本次改动产生的孤儿代码

4. **目标驱动**

- 将任务拆成可验证目标（如：`加校验 → 先写非法输入失败用例 → 让用例通过`）

5. **文档先行落地**

- 功能实现完成后，把技术文档写入 `docs/`（新功能新建编号文档，旧功能更新对应文档）
- 文档应记录：实现思路、关键文件、数据结构 / API 契约、注意事项，供后续 AI 参考
- 新增 / 更新 / 删除文档后，必须同步更新 `docs/README.md` 索引（含标题与描述），保证索引不失效
- 需求简单、纯样式微调等无需文档的场景可豁免，但涉及逻辑 / 数据结构 / API 的变化必须记录

6. **红线优先**

- 上述原则与硬性红线冲突时，以红线为准

---

## 🧩 技术选型与设计约定

1. **UI 组件与图标**

- 统一使用 `tdesign` 组件库及图标，关于组件用法，使用 `tdesign-mcp-server` 这个 mcp 查看
- 禁止手写 SVG，除非 `tdesign` 未提供对应图标

2. **设计风格**

- 采用 **Fluent Design** 设计风格
- 强调层级、阴影、动效的自然流畅

3. **样式管理**

- 布局与尺寸可使用 `unocss`（如 `flex`、`m-8px`）
- 颜色类必须使用 `tdesign` 的 CSS Token（UnoCSS 已映射 `text-td-primary` / `bg-td-container` 等 shortcut），禁止直接使用裸色值

4. **弹窗与抽屉**

- 弹窗 / 抽屉一律使用 tdesign **命令式 API**：`DialogPlugin`（默认 `placement: 'center'`）或 `DrawerPlugin`（内容较多、需更宽编辑面板时）
- 每个弹窗拆成两个文件：
  - `.tsx` **外壳**：导出 `openXxx(options)` 打开函数，内部调用 `DialogPlugin` / `DrawerPlugin`，将 `.vue` 内容组件经
    `body: () => h(XxxContent, props)` 渲染进弹窗；`destroyOnClose: true`、`footer: false`（操作按钮由内容组件内部提供）
  - `.vue` **内容**：命名 `XxxContent.vue`，承载表单 / 按钮等全部 UI 与提交状态，通过 `emit('close' / 'success')` 与外壳通信
- 禁止：
  - 整个弹窗（含内容）全部写在 `.tsx` 中
  - 用声明式 `<t-dialog :visible>` + `v-if` 挂载实现业务弹窗
  - 弹窗内容使用 `.tsx` 渲染而非 `.vue` 组件
- 其余场景一律使用 `.vue` 组件

5. **组件存放规则**

- 非公共组件：放在当前页面目录下的 `components/`
- 通用组件：才可放入 `src/renderer/src/components/`
- 禁止将业务组件直接放入 `src/renderer/src/components/`

---

## 🏗️ 本项目架构约定

1. **别名**

- `$/*` → `src/main/src/*`（仅 main / preload）
- `~/*` → `src/preload/src/*`（仅 main / preload）
- `@/*` → `src/renderer/src/*`（仅 renderer）
- `@common/*` → `src/common/*`（三端可用）
- `@resources/*` → `resources/*`（仅 main，`?asset` 引入）

2. **跨进程调用链路**

- 渲染层不直接触达 Node / SQLite：`preload/src/modules/<域>/` 定义桥（`ipcRenderer.invoke('<域>:<动作>')`）→ `preload/index.ts` 组装 → 契约类型同步写进 `src/renderer/src/vite-env.d.ts` 的 `Window.preload` → main 侧同域 `dbIpc.ts` / `registerIpc.ts` 落地 handler
- main 侧各域 IPC 统一在 `src/main/src/registerIpc.ts` 注册

3. **数据库**

- 表结构定义在 `src/main/src/db/schema/`，在 `schema/index.ts` re-export 后运行 `npx drizzle-kit generate` 生成迁移（输出 `resources/drizzle/`，随包 asarUnpack）
- 查询按域拆 repo（`db/repo/<域>Repo.ts`），IPC 层只做参数校验与转发

4. **新窗口**

- 渲染层入口：`src/renderer/index.html` 指向的窗口入口在 `src/renderer/src/windows/<窗口名>/`（自带 main.ts / App.vue / router）；如需独立 preload 再扩展 `electron.vite.config.ts` 的多入口

---

## 📁 目录结构示例 + 错误示例对照表

### ✅ 推荐目录结构

```text
src/
├── common/types/                      # 三端共享数据契约
├── main/src/
│   ├── app/                           # 窗口等应用外壳
│   ├── db/                            # client + schema + repo + dbIpc
│   │   └── schema/index.ts
│   └── registerIpc.ts                 # IPC 聚合
├── preload/
│   ├── index.ts                       # contextBridge 组装
│   └── src/modules/<域>/              # 渲染层桥
└── renderer/src/
    ├── components/                    # 仅通用组件
    ├── hooks/
    ├── utils/
    └── windows/main/
        ├── main.ts / App.vue / router.ts
        ├── store/
        └── pages/<页面>/
            ├── index.vue
            └── components/            # 页面私有组件
```

### ❌ 错误示例与原因

| 错误示例                                  | 原因                                                        |
|-------------------------------------------|-------------------------------------------------------------|
| `src/renderer/src/UserList.vue`           | 业务代码不应散落在 renderer/src 根部，页面进 windows/<窗口>/pages/ |
| `pages/dashboard/api.ts`                  | 请求桥必须集中在 `preload/src/modules/`，页面不得直连 ipcRenderer |
| `components/OrderDetailModal.vue`         | 违反组件存放规则，非通用组件不应放在 `src/components/`      |
| 渲染层直接 `require('better-sqlite3')`    | 渲染层不碰 Node，必须走 `window.preload` 桥                 |
| 使用 `<select>` 或 `alert()`              | 违反 RL-05，必须使用 `tdesign`                              |
| 手写 SVG 图标                             | 违反 UI 约定，应使用 `tdesign` 图标                         |
| `const data: any = res.data`              | 违反 RL-04，禁止 `any`                                      |
| `color: #1677ff;`                         | 违反样式约定，应使用 tdesign CSS Token                      |
| `FilterModal.vue` 作为弹窗                | 违反约定，弹窗外壳必须用 `.tsx`（`DialogPlugin` 命令式）    |
| 弹窗内容直接写在 `.tsx` 内                | 违反约定，弹窗内容必须用 `.vue` 组件（`XxxContent.vue`）    |
| `<t-dialog :visible>` + `v-if` 声明式弹窗 | 违反约定，应使用 `DialogPlugin` / `DrawerPlugin` 命令式 API |
| 单文件超过 300 行未拆分                   | 违反 RL-06                                                  |
