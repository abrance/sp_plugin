# 评估：继续堆模型能力 vs 直接接本机智能体（Pi / pi-web）

日期：2026-10-20 · 目标机：本机（SP 19.2.0，Pi 1.2.0，pi-web 0.9.3 源码在 `/opt/mystorage/github/pi-web`）

## 现状基线

| 项 | 数字 |
| --- | --- |
| base-ai-bot 现有代码 | 2986 行 TS/TSX（`tools.ts` 896、`report.ts` 280、`memory.ts` 262） |
| 现有工具数 | 30 个手写工具（task/project/tag/timer/report/memory） |
| 模型交互 | 单轮非流式 `POST /chat/completions`，最多 10 轮工具循环 |
| 错误处理 | `pushError(message)` 一条字符串，无分类、无重试、无请求日志 |
| 本机智能体可用性 | `pi` 1.2.0（`--print` / `--mode json` / `--mode rpc` / SDK）；pi-web 0.9.3 有 `/api/agent/*` 与 SSE |

## 路径 1：继续补充模型对接能力

| 事项 | 复杂度 | 代码量 | 风险 | 解锁 |
| --- | --- | --- | --- | --- |
| 错误诊断（分类/重试/日志面板/复制诊断） | 低 | 250–350 | 低 | 直接解决“消息断了不知道为什么” |
| 流式输出（SSE + 增量渲染 + 中断） | 中 | 200–300 | 中（需改 chat 循环与消息模型） | 首字延迟感知、可中途停 |
| 上下文管理（token 计数、自动裁剪、压缩摘要） | 中 | 200–300 | 中 | 长会话不爆窗 |
| 会话级模型/温度、提示词模板、工具开关 | 低 | 150–250 | 低 | 场景化预设 |
| 附件/图片输入 | 中 | 150–250 | 中（多模态端点差异） | 截图问任务 |
| 工具继续加（日历、批量迁移、模板任务…） | 低-中 | 每个 50–150 | 低 | 单点能力 |

上限：仍是一个“带 30 个手写工具的聊天客户端”。没有文件/bash/浏览器/子代理/skills；每加一个能力都要自己写工具 + 自己处理边界。

## 路径 2：接本机智能体

### 2a. `pi -p --mode json`（一次性进程 + 轮询事件）

- 可行性：**可行**。已实测 `pi -p --model llmgw/deepseek-flash` 冷启动 + 一次回答 = **2.3 s**；`--mode json` 输出 JSONL 事件，`--session-id` 可续接会话。
- 硬约束（实测自 `plugin-node-executor.js`）：
  - `executeNodeScript` 的 spawn 分支把子进程 env 清成只剩 `NODE_ENV` + `ELECTRON_RUN_AS_NODE`（**无 PATH、无 HOME**）→ 脚本里必须显式传 `PATH`/`HOME`，`pi` 要用绝对路径。
  - 该分支同步捕获 stdout 直到进程退出，**拿不到流式**；默认超时 30 s、上限 300 s。
  - 结论：必须“脚本 spawn 分离进程 → 立即返回 → 插件轮询输出文件/session JSONL”。
- 复杂度：中。新增 `agent-bridge.ts`（spawn 包装、env 重建、session-id 映射、事件→消息映射、abort、错误归类）+ 设置节 + 双模式 UI 切换：**约 350–500 行，1–2 天**。
- 解锁：Pi 全量工具（read/bash/edit/write）、MCP 服务器、skills、subagents、memory、多模型/provider、上下文压缩。
- 风险：安全（Pi 带 bash，任务标题里的 prompt injection 会直接执行命令）→ 默认只开只读工具集 `read,grep,ls`，bash/edit 需显式勾选。

### 2b. RPC 常驻（`RpcClient` 守护进程）

- 可行性：**可行**，`@earendil-works/pi-coding-agent` 已全局装（1.2.0）并导出 `RpcClient`。
- 需要：detached 守护进程（node 直跑全局包）、本地 HTTP/Unix socket 或命令/响应文件队列、健康检查、崩溃重建、退出清理。
- 复杂度：高。**约 800–1000 行，3–5 天**，还要处理端口/进程泄漏/版本漂移。
- 解锁：真 token 级流式、`steer` 中途纠偏、运行中切模型、`abort`、扩展 UI 交互。

### 2c. 直连 pi-web HTTP API

- 结论：**不推荐，基本被堵死**。`lib/request-security.ts` + `proxy.ts` 做 Origin/Host 同源校验，SP 渲染进程（`file://`）直接 fetch `127.0.0.1:30141` 会被拒；绕开要再写一个 node 侧代理跳板，那还不如直接走 2a/2b。另外它要求 pi-web 常驻。
- 唯一价值：复用 pi-web 的 session 管理，但我们在 SP 里用不到它的 UI。

## 建议路线（按投入产出）

1. ~~**Phase 0（0.5 天，先止痛）**~~：错误诊断。→ 已随 Phase 1 一起落地（Pi 模式失败会带 stderr 原文）。
2. **Phase 1（已实现，v1.3.0）**：路径 2a 作为第二种后端（`agentMode: 'pi'`），默认只读工具集，
   `executeNodeScript` 起 detached `pi --mode json`、轮询 JSONL 事件映射到聊天。
3. **Phase 2（按需）**：需要真流式 / 中途纠偏 / 切模型时再上 2b 守护进程。

实现细节见 `plugins/base-ai-bot/README.md` 的 “Two backends”。

不建议：继续在路径 1 里堆到“准 agent”（自写文件、bash、抓取工具）——那是重造 Pi，且安全边界更难管。
