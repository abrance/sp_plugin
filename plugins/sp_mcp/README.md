# sp_mcp — Super Productivity 的 MCP 桥

让外部 agent（Pi / Claude Code / 任何 MCP 客户端）读写 SP 的任务、项目、tag、计时器和今日计划。

它替换掉了仓库外的旧 SP-MCP 散件（`~/.local/share/super-productivity-mcp` 的 Python 版）。

## 为什么是「文件队列」而不是 HTTP 端口

SP 19.2.0 的 iframe 面板**没有 node 环境**，插件能用的通道只有两条：

| 通道 | 代价 | 结论 |
| --- | --- | --- |
| `PluginAPI.request` + `allowedHosts` | 需要 `http` 权限；`allowedHosts` 只精确匹配主机名、忽略端口，等于把 `127.0.0.1` 上所有端口一次性放行；跨域/私有网络策略还要看 renderer | 不用 |
| `executeNodeScript`（`nodeExecution` 权限） | 首次启用插件时弹一次原生授权；每次调用在 VM 沙箱里跑 `fs`/`path`/`os` | **采用** |

所以：**宿主侧 `plugin.js` 每 800ms 扫一次共享目录里的命令文件 → 用插件 API 执行 → 写回响应文件**。
不监听端口、不需要凭据、不依赖 Python。

## 常驻模型（v0.2.0）

轮询循环在**宿主侧 `plugin.js`**里，不在面板里。SP 一启动（且插件为启用状态）宿主就开跑，
面板关掉、iframe 被销毁都不影响；只有 SP 退出或取消勾选「Accept commands」才停。

- `plugin.js` 是唯一属主：**只有它轮询**。面板 iframe 降级成纯状态页，只读 `state/plugin.json`。
- 前提条件：`desktop` 平台 + 有 `executeNodeScript`；否则打一行 `console.log` 后退出，不影响 SP 启动。
- 全新安装、面板从没打开过也能跑：配置缺失时用默认值（`~/.local/share/sp-mcp-bridge`，800ms，开）。
- 配置单一来源 = SP 的插件持久化键 `sp-mcp-bridge:config`（面板写、宿主读）。宿主每 1.5s 重读一次，
  所以面板改目录／改间隔／关开关都会在 1.5s 内生效。

## 组成

```
plugins/sp_mcp/
  plugin.js            宿主侧轮询循环（构建产物，由 src/host 打出来；SP 启动即加载）
  src/
    host/main.ts       入口：读 PluginAPI、判平台、注册 hook、起循环
    host/bridge.ts     可测的宿主循环：配置热重载 + 单一属主
    lib/actions.ts     动作表：一个动作 = 一次插件 API 调用
    lib/scripts.ts     宿主侧 fs 脚本（只用 fs/path/os，会被路由到 VM 沙箱层）
    lib/runner.ts      轮询逻辑：串行执行、超时、过期丢弃、心跳（面板与宿主共用）
    lib/config-core.ts 配置键/默认值/校验（不依赖 plugin-kit，自检可直接加载）
    App.tsx            面板：只显示 `state/plugin.json` 的心跳 + 改配置，不轮询
  bridge/              agent 侧：stdio MCP server（Node ≥ 22.18 直接跑 .ts）
    src/queue.ts       命令队列客户端：串行、超时、健康检查、崩溃残留清理
    src/tools.ts       23 个 MCP 工具定义
  vite.host.config.ts  plugin.js 的 lib 构建（IIFE，单文件）
  selftest.mjs         不装 SP 也能跑的自检
```

共享目录（默认 `~/.local/share/sp-mcp-bridge`）：

```
commands/    agent 写命令（写 .tmp 再 rename，读者永远看不到半个文件）
responses/   插件写响应，agent 读完即删
state/plugin.json   心跳（协议版本、版本号、计数、上次动作）
```

## 安装与启动

**1. 装插件（只需要一次，GUI 操作）**

Super Productivity → Settings → Plugins → Install from file → 选
`release/sp_mcp-0.2.0.zip` → 启用插件。
启用/首次加载时会弹一次「允许运行系统命令」的原生授权，必须允许（脚本只用 `fs`/`path`/`os`）。

**面板不是必须的**：装好并启用后，后台循环在 SP 每次启动时自己跑。想改目录、改间隔、
临时停掉命令接收，再打开一次侧边栏。首次建议打开一次，确认徽标显示 `polling`。

**2. 起 agent 侧的 MCP server（stdio，不需要端口）**

```bash
cd /opt/mystorage/github/sp_plugin/plugins/sp_mcp/bridge
node src/main.ts          # Node >= 22.18，直接跑 TypeScript
```

停止：`Ctrl-C`（SIGINT/SIGTERM 都会正常关闭）。诊断日志全部走 stderr，stdout 只放 MCP 协议。

挂到 Pi（`mcp.json`）：

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "node",
      "args": ["/opt/mystorage/github/sp_plugin/plugins/sp_mcp/bridge/src/main.ts"]
    }
  }
}
```

共享目录不是默认值时，两边都要改：插件侧在侧边栏填路径（写进插件持久化配置），agent 侧设环境变量
`SP_MCP_BRIDGE_DIR=/path/to/dir`。

**3. 验证**

```bash
node selftest.mjs                                   # 7 项不装 SP 的自检（含宿主循环）
cd bridge && printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bridge_status","arguments":{}}}' \
 | node src/main.ts
```

`bridge_status` 返回 `alive: true` 说明宿主循环在收命令；`pluginState: null` 说明插件没跑
（没装/没启用/`nodeExecution` 授权被拒/SP 版本低于 19.2.0）。

**升级/重装**：Settings → Plugins → 删掉旧版 → Install from file 选新 zip → 启用。
面板是否打开都不影响，重装后下一次 SP 启动即生效。

## 工具

| 工具 | 说明 |
| --- | --- |
| `bridge_status` | 宿主循环存活、版本、计数、目录（失败时先看这个） |
| `get_tasks` / `get_task` | 列任务 / 单任务（`tag: "TODAY"` 取今日计划） |
| `create_task` | 建任务；`due_day` 是截止日，`plan_today` 才进今日计划（两件事） |
| `update_task` | 增量改；`tag_ids` 覆盖全部 tag，`add_tag_names` 追加 |
| `complete_task` / `delete_task` | 完成 / 永久删除（含子任务） |
| `reorder_tasks` | 项目内或父任务内重排，要传完整有序 id 列表 |
| `get_projects` / `create_project` / `update_project` | 项目 |
| `get_tags` / `create_tag` / `update_tag` | tag（`get_tags` 顺带返回 TODAY 的 taskIds） |
| `add_tag_to_task` / `remove_tag_from_task` | 按名字或 id 增删 tag |
| `get_today` / `plan_tasks_today` / `remove_tasks_from_today` | 今日计划（写 TODAY tag） |
| `get_current_task` / `start_task` / `stop_tracking` | 计时器 |
| `show_notification` | 应用内提示 |

## 已知限制

- **常驻边界**：SP 退出就断，重开 SP 自动恢复；关侧边栏、切视图都不影响。agent 侧协议没变，
  `alive` 的判定还是「心跳 10s 内且 `enabled`」。
- **并发**：一轮只跑一条命令，agent 侧也串行排队。吞吐上限是「一动作一往返」，
  批量改 20 个任务 ≈ 20 个来回。
- **延迟**：默认 800ms 轮询，单个调用的体感延迟约一个轮询周期。侧边栏可调到 400ms。
- **开销**：每轮最多一次宿主调用读队列，心跳/响应合并成一次提交；面板开着时另有 1.5s 一次读心跳
  （只读 `state/plugin.json`，不碰任务数据）。
- **超时**：agent 侧默认 15s。超时后会**删掉命令文件**并报错；如果插件已经执行完只是响应慢，
  这次改动可能已经生效 —— 报错文案里写了「先读一下受影响的任务再重试」。写操作不会自动重试，
  只有 `get_*` 会重试一次。
- **过期命令**：命令签发超过 120s 未执行会被拒绝（防止 SP 关了一天再启动时把旧命令重放）。
- **当前任务**：19.2.0 不暴露「正在计时哪个任务」，`get_current_task` 是 `currentTaskChange` hook 的镜像，
  插件启动后没有切过任务时返回 `null`。
- **单属主**：命令只能被执行一次的前提是「只有 `plugin.js` 轮询」。面板 iframe 不再轮询，
  所以同一份安装里不存在两个消费者。
- **不再支持**（相对旧 Python 版）：`persistDataSynced` / `loadSyncedData` 透传、`openDialog` 透传、
  以及旧版里 `getTasks` 返回 74KB 全量原始对象的做法 —— 现在只返回摘要字段（要 notes 用 `get_task`）。

## 安全面

- 权限：`nodeExecution`（唯一被强制的权限，启用时弹窗一次）+ 任务/项目/tag/计时器读写 + `dispatchAction`
  + `persistDataSynced`/`loadSyncedData`（配置持久化）。没有 `http`，`allowedHosts` 为空 ——
  插件不具备任何对外网络能力。
- 能干什么：读你全部任务、项目、tag、notes；改/删任务；改文件系统里共享目录下的三个子目录
  （脚本写死只用 `args[0]` 拼路径，无法读到别处 —— 但 VM 沙箱里的 `fs` 本身是完整的，
  真正的边界是「脚本是我们自己写的、不接收外部脚本」）。
- 谁能控制它：任何能在你的账号下写 `commands/` 的本机进程。共享目录默认 0755，
  多用户机器上建议 `chmod 700 ~/.local/share/sp-mcp-bridge`。
- 凭据：本插件不需要也不保存任何凭据；命令队列里不会有密码。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `[plugin-down] ... has never polled` | 插件没装/没启用；`nodeExecution` 授权被拒；SP < 19.2.0。启用一次插件并允许授权 |
| `[plugin-down] ... stopped polling 120s ago` | SP 退出了，或面板里取消了「Accept commands」。关面板本身不会造成这个 |
| 面板徽标 `stopped` 但 SP 在跑 | 同上；另外看 SP 开发者工具的 console 有没有 `[sp_mcp]` 开头的行（宿主循环没起来时会有原因） |
| `[timeout]` | 宿主在但这一轮卡住；看 SP console 的 `[sp_mcp]` 日志 |
| `executeNodeScript unavailable` / `NODE_EXECUTION_PERMISSION_DENIED` | 启用时拒绝了授权：插件页重新授权，再重启 SP |
