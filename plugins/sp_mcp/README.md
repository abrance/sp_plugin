# sp_mcp — Super Productivity 的 MCP 桥

让外部 agent（Pi / Claude Code / 任何 MCP 客户端）读写 SP 的任务、项目、tag、计时器和今日计划。

它替换掉了仓库外的旧 SP-MCP 散件（`~/.local/share/super-productivity-mcp` 的 Python 版）。

## 为什么是「文件队列」而不是 HTTP 端口

SP 19.2.0 的 iframe 插件**没有 node 环境**：`plugin.js` 在 renderer 里通过 `new Function` 执行，
拿不到 `require` / `process` / `http`，所以旧方案里「插件自己监听 19701 端口」在 19.2.0 上不成立。
插件能用的只有两条通道：

| 通道 | 代价 | 结论 |
| --- | --- | --- |
| `PluginAPI.request` + `allowedHosts` | 需要 `http` 权限；`allowedHosts` 只精确匹配主机名、忽略端口，等于把 `127.0.0.1` 上所有端口一次性放行；跨域/私有网络策略还要看 renderer（无法在不装插件的条件下验证） | 不用 |
| `executeNodeScript`（`nodeExecution` 权限） | 首次弹一次原生授权；每次调用在 VM 沙箱里跑 `fs`/`path`/`os` | **采用** |

所以：**插件每 800ms 扫一次共享目录里的命令文件 → 用插件 API 执行 → 写回响应文件**。
不监听端口、不需要凭据、不依赖 Python，插件自己能干的活全在自己进程里干。

## 组成

```
plugins/sp_mcp/
  src/                 插件（SolidJS iframe，构建成单文件 index.html）
    lib/actions.ts     动作表：一个动作 = 一次插件 API 调用
    lib/scripts.ts     宿主侧 fs 脚本（只用 fs/path/os，会被路由到 5s 的 VM 沙箱层）
    lib/runner.ts      轮询循环：串行执行、超时、过期丢弃、心跳
  bridge/              agent 侧：stdio MCP server（Node ≥ 22.18 直接跑 .ts）
    src/queue.ts       命令队列客户端：串行、超时、健康检查、崩溃残留清理
    src/tools.ts       23 个 MCP 工具定义
  selftest.mjs         不装 SP 也能跑的自检
```

共享目录（默认 `~/.local/share/sp-mcp-bridge`）：

```
commands/    agent 写命令（写 .tmp 再 rename，读者永远看不到半个文件）
responses/   插件写响应，agent 读完即删
state/plugin.json   插件心跳（协议版本、版本号、计数、上次动作）
```

## 安装与启动

**1. 装插件（只需要一次，GUI 操作）**

Super Productivity → Settings → Plugins → Install from file → 选
`release/sp_mcp-<version>.zip` → 启用插件 → 打开它的侧边栏。
首次会弹一次「允许运行系统命令」的原生授权，必须允许（脚本只用 `fs`/`path`/`os`）。
侧边栏显示 `polling` 就代表在收命令了。

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

共享目录不是默认值时，两边都要改：插件侧在侧边栏填路径；agent 侧设环境变量
`SP_MCP_BRIDGE_DIR=/path/to/dir`。

**3. 验证**

```bash
node selftest.mjs                                   # 6 项不装 SP 的自检
cd bridge && printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bridge_status","arguments":{}}}' \
 | node src/main.ts
```

`bridge_status` 返回 `alive: true` 说明插件在轮询；`pluginState: null` 说明插件没跑/没开侧边栏。

## 工具

| 工具 | 说明 |
| --- | --- |
| `bridge_status` | 插件存活、版本、计数、目录（失败时先看这个） |
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

- **并发**：插件一轮只跑一条命令，agent 侧也串行排队。旧桥并发发 5 个就打挂端口的问题不存在，
  但吞吐上限就是「一动作一往返」，批量改 20 个任务 ≈ 20 个来回。
- **延迟**：默认 800ms 轮询，单个调用的体感延迟约一个轮询周期。侧边栏可调到 400ms。
- **超时**：agent 侧默认 15s。超时后会**删掉命令文件**并报错；如果插件已经执行完只是响应慢，
  这次改动可能已经生效 —— 报错文案里写了「先读一下受影响的任务再重试」。写操作不会自动重试，
  只有 `get_*` 会重试一次。
- **过期命令**：命令签发超过 120s 未执行会被拒绝（防止关了一天再打开时把旧命令重放）。
- **当前任务**：19.2.0 不暴露「正在计时哪个任务」，`get_current_task` 是插件侧 `currentTaskChange`
  hook 的镜像，插件启动后没有切过任务时返回 `null`。
- **不再支持**（相对旧 Python 版）：`persistDataSynced` / `loadSyncedData` 透传、`openDialog` 透传、
  以及旧版里 `getTasks` 返回 74KB 全量原始对象的做法 —— 现在只返回摘要字段（要 notes 用 `get_task`）。
- **不做的**：不自动启动、不后台常驻、不把数据发到网络。插件只在被 SP 加载且侧边栏开启时轮询。

## 安全面

- 权限：`nodeExecution`（唯一被强制的权限，弹窗一次）+ 任务/项目/tag/计时器读写 + `dispatchAction`。
  没有 `http`，`allowedHosts` 为空 —— 插件不具备任何对外网络能力。
- 能干什么：读你全部任务、项目、tag、notes；改/删任务；改文件系统里共享目录下的四个子目录
  （脚本写死只用 `args[0]` 拼路径，无法读到别处 —— 但 VM 沙箱里的 `fs` 本身是完整的，
  真正的边界是「脚本是我们自己写的、不接收外部脚本」）。
- 谁能控制它：任何能在你的账号下写 `commands/` 的本机进程。共享目录默认 0755，
  多用户机器上建议 `chmod 700 ~/.local/share/sp-mcp-bridge`。
- 凭据：本插件不需要也不保存任何凭据；命令队列里不会有密码。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `[plugin-down] ... has never polled` | 插件没装/没启用/侧边栏没开过 → 打开一次侧边栏 |
| `[plugin-down] ... stopped polling 120s ago` | SP 关了，或侧边栏被关掉 |
| `[timeout]` | 插件在但这一轮卡住；看侧边栏 Recent activity 的第一条错误 |
| 侧边栏显示 `stopped` | 勾掉/取消了「Accept commands from the agent bridge」，或点了 Stop |
| `nodeExecution` 弹窗被拒 | 插件无法读写共享目录；在 SP 插件页重新授权后重开侧边栏 |
