# docs/ 文档索引

> 本目录存放项目技术文档，供后续 AI 参考。 **请先读本文件**，按功能定位目标文档，无需逐个查看文件名。

## 索引

### app/ —— 应用外壳与工程基线

| 文档                                             | 描述                                                                                                             |
|--------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| [01-init.md](./app/01-init.md)                   | 项目初始化（2026-09-15）：参考 mistrelle 搭建 electron-vite 骨架（main/preload/renderer/common 四段 + windows 多窗口模式）、TDesign + UnoCSS + 自动导入 + Pinia + Vue Router、drizzle + better-sqlite3 数据库基线、db:ping 全链路示例、各配置文件要点与别名约定；macOS Dock 跟随主窗口可见性（2026-09-16） |
| [02-管理界面.md](./app/02-管理界面.md)           | 管理界面（2026-09-15）：侧边栏布局（t-menu 路由导航）、7 个页面职责与数据来源（首页统计看板 + 用量明细表 + 日志页条件分页/行展开详情/进行中实时展示）、3 组命令式弹窗两文件模式、通用组件目录（PageLayout / EChart / usage）、server:status 状态推送链路、日志页 useLogRefresh 三路刷新（log:changed 推送 + 30s 轮询兜底 + 手动）、设置页三卡片（外观/开机自启/网络代理） |
| [03-托盘.md](./app/03-托盘.md)                   | 系统托盘（2026-09-16）：registerAppTray/refreshTrayUsage 双通道刷新（写库即时 + 30s 兜底）、统计面板弹窗（trayPanel 窗口定位/失焦隐藏/点击竞态抑制）、click 与 right-click 平台分支（macOS 不可同时 setContextMenu）、macOS 标题显示今日用量；**面板亚克力外观（2026-09-17）**：原生材质（darwin vibrancy / win32 acrylic）+ 渲染层面板底与卡片底两层半透明叠加、`--fluent-card-bg` 作用域重定向与渐晕 `--metric-tint-alpha` 旋钮、三条已知限制（系统主题跟随 / linux 无模糊 / Win10 无材质） |
| [04-统计看板.md](./app/04-统计看板.md)           | 统计看板（2026-09-16）：用量聚合重构（usage_daily 增加供应商/缓存/成功失败/耗时维度 + usage_hourly 小时表）、统一写入路径 recordRequest、统计口径权威定义表、时间维度解析与活跃度窗口、**模型速度折线（近七天，唯一实时聚合 request_logs 的统计项）**——为什么不用聚合表（duration_ms 含失败请求而 token 只算成功，口径错配）、速度口径与 Top 5、四条已知限制（上游未返回 usage 即无数据点、端到端耗时含预填充、窗口滚动、仅成功请求）、echarts 图表基元（按需注册 + token 取色）、共享看板组件、首页与托盘面板双端结构 |
| [05-日志代码查看器.md](./app/05-日志代码查看器.md) | 日志代码查看器（2026-09-16）：行展开正文/错误信息改用 Monaco 只读渲染，替换 v-html 与 break-all 大文本方案；动态加载、入口必须用含 contributions 的 root `monaco-editor`（`editor.api` 会报 UNKNOWN service actionWidgetService）、`exports` 映射下的 worker 路径、colors 需带 `#` 而 token rules.foreground 不能带 `#`、tdesign token 主题、空值/高度/多实例销毁约定 |
| [06-应用图标.md](./app/06-应用图标.md)           | 应用图标（2026-09-16）：图标落点与分工（build 的 png/icns/ico 为不透明满底应用图标；resources/icon.png 为透明底托盘专用机器人图）、尺寸与用途、换图设计约束（托盘图需裁掉留白）、用系统 sips + iconutil + Node 打包 ICO 与用 Pillow 生成托盘图的完整步骤 |
| [07-开机自启.md](./app/07-开机自启.md)           | 开机自启（2026-09-16）：以系统登录项为唯一权威不落库、未打包禁用以防污染、macOS/Windows 平台差异（macOS 无 args 透传故用 wasOpenedAtLogin、Windows 读写需同 path/args）、登录启动静默驻留托盘（不建窗 + 隐藏 Dock）、app:* IPC 契约、second-instance 唤窗配套 |
| [09-看板卡片规范.md](./app/09-看板卡片规范.md)   | 看板卡片规范（2026-09-16）：MetricCard 四段解剖（图标+标签+状态胶囊 / 大数值+小单位 / 卡内迷你可视化 / 页脚明细）、卡片底色反转为「比面板底更亮」的浮起层级、迷你图只用真实数据、useUsageCards 配置派生、胶囊文案表、ServiceStatusBar 补齐托盘缺失的服务状态、新指标接入步骤；**卡片底 token 化与半透明适配（2026-09-17）**：`--fluent-card-bg`（缺省值与内容容器合成结果一致，窗口可整体重定向为玻璃底）+ 分档渐晕的 `--metric-tint-alpha` 透明度旋钮 |

### data/ —— 数据模型

| 文档                                             | 描述                                                                                                             |
|--------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| [01-数据模型.md](./data/01-数据模型.md)          | 6 张表结构（providers/models/settings/request_logs/usage_daily/usage_hourly）、request_logs 全量采集字段（正文/标头/七维 token/请求 ID）与**两阶段落库**（startLog 落 pending 行 → recordLog 按 request_id upsert 回填 / 启动收口残留为 499）、最近 7 天惰性清理（按天节流）、用量双粒度聚合表（日永久 + 小时 7 天）与 7 类统计口径、**删除 / 改名与历史数据**（名字快照语义：删除不影响历史、为什么不需要软删除、改名按 provider_id/model_id 集合式改写历史 + 性能边界与已知限制）、repo 与 IPC 通道清单（含 log:changed 推送）、@common/types 三端契约组织、新增表流程备忘 |

### server/ —— 本地代理服务

| 文档                                             | 描述                                                                                                             |
|--------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| [01-本地代理服务.md](./server/01-本地代理服务.md) | 127.0.0.1 OpenAI 兼容代理：生命周期（启动/保存重启/退出）、鉴权（Bearer + x-api-key）、显式路由（/v1/models + /v1/chat/completions）、模型映射与同协议纯透传、SSE 流式管道与 usage（含明细）提取、请求/响应正文与标头全量采集（**线上口径：记实际发给提供商的请求与提供商返回的响应**；两阶段落库：转发前落 pending 行即时可见「进行中」→ 结束后 upsert 回填；脱敏 + 兜底估算）、log:changed 实时推送（300ms 合并广播）、OpenAI 风格错误表、**出站统一 axios（upstreamHttp.ts，2026-09-17）**：响应拦截器把网络错误增强为「错误码: 底层原因: 中文提示」+ 上游代理设置（server.proxyUrl，https 上游走 CONNECT 隧道） |
| [02-协议适配与转换.md](./server/02-协议适配与转换.md) | 三大接口支持（2026-09-16）：提供商接口类型（OpenAI Chat / OpenAI Responses / Anthropic Messages）、同协议透传 + 异协议经 ai-sdk 中间层双向转换（`src/main/src/server/protocol/`）、SSE 重编码与 reasoning_content 约定、baseUrl 统一为完整 API 根（不补 /v1）、转换路径日志线上捕获（wireCapture 注入 provider fetch，底层 axiosFetch + usage 明细）、转换路径限制清单 |
