# 配置、存储与升级备份

## 先确定实际服务

从当前页面地址读取 `/api/health`，确认项目 id、root 和 rootExists；从 `/api/storage` 确认当前资料库和配置文件。不要把仓库默认配置当成运行服务的实际配置，也不要为了查询配置重启用户服务。

| 内容 | 位置与生效方式 |
| --- | --- |
| 项目目录 | 启动 `--config` 指定的 JSON，默认 `callgraph.projects.json`；Windows 包使用 `callgraph.projects.local.json`。页面新建项目通过系统目录选择器接入已有源码并持久化，无需重启；手工编辑后重启 |
| 资料库存储 | 项目配置文件旁 `coderova.storage.json`；页面“存储设置”可修改，重启生效，不自动迁移 |
| LSP | `CALLGRAPH_LSP_CONFIG` 指定的文件，或默认 `callgraph.lsp.local.json`；Java 配置 command/args/workspaceRoot/settings，Rust 使用 PATH 中的 rust-analyzer；参见仓库 README |
| LSP 查询保护 | 同一 LSP 文件顶层 collection：concurrency 默认 4（1–32），requestTimeoutSeconds 默认 15（1–300 秒），maxRetries 默认 3（0–3，首次之外的重试次数）。新任务读取，配置变化使原缓存会话失效 |
| 每轮采集限制 | 页面表单/API 请求，不是 storage 配置；maxDepth 1–100，maxNodes 1–10000，可同时设置或省略；API requestBudget 1–1000 仍必填 |
| 浏览器偏好 | 主题、侧栏宽度、目录排序/折叠、自动换行等；换行跨所有节点共享，不写入节点事实 |

页面“新建项目”是注册已存在源码目录，不生成脚手架。源码路径与资料库存储路径承担不同职责，移动资料库不移动源码，也不会自动修复项目 root。

## 资料库位置

在项目配置文件旁写入：

```json
{"root":"D:/CodeRovaLibrary"}
```

相对 root 相对于项目配置文件所在目录。无存储配置时使用启动工作目录的 `graphs/`。非默认 `--graphs <目录>` 优先于配置；当前实现用字面值 `graphs` 判断默认，所以显式 `--graphs graphs` 仍会读取配置文件。以 `/api/storage` 返回的 commandLineOverride 为准。

页面“存储设置”→“选择目录”→“保存位置”只写配置；界面同时显示当前和重启后位置。备份并迁移资料后，在授权范围内重启服务，再检查 `/api/storage` 与图列表。原文件保留原位。

## 图事实与说明分离

```text
资料库/
  .coderova/library.json
  <分类目录>/
    <slug>.json
    .annotations-<slug>/<快照引用>.json
    <slug>.deleted
```

根目录中的图也受支持。图 JSON 保存符号、源码位置、关系与证据，通过 `_annotations` 引用独立说明快照。节点 description、职责/阶段/阅读状态及边说明独立存储；API 读取时合成返回。旧合并图仍可读取，只在保存时拆分；CLI analyze 导出仍为可携带的合并 JSON。

`.coderova/library.json` 保存项目显示名与分组，包括空分组；目录/分组/图重命名不改变稳定 ID、slug 或源码位置。页面“新建目录”对应项目内分组；移动图到其他分组才会改变物理分类路径。排序与折叠仍在浏览器中。

说明先完整写入，再原子更新图引用；旧快照保留，不自动清理。不要手工改引用或只复制图 JSON，否则可能失去说明。移动、恢复和备份都保留关联快照。`.deleted` 是回收站中的图，不是可随意清理的临时文件。

## 备份与升级

1. 在页面核对当前草稿，明确保存或放弃；内存草稿不能靠复制目录备份，服务重启会清除。
2. 复制完整资料库，包括隐藏 `.coderova`、`.annotations-*` 及回收站文件；按需要保留 layouts、scenarios、项目配置、LSP 配置、storage 配置。
3. 将新版解压到新目录，避免空配置覆盖旧配置。自定义绝对 root 可继续指向原资料库；相对 root 按新配置文件位置重新核对。
4. 启动新版后检查 `/api/health`、`/api/storage`、项目/目录/图标题和至少一条节点说明。只读验收不要改写真实图。

项目源码与 LSP 索引缓存不在图备份内。源码版本变化后，已有调用图证据可能过期；增量续采会合并，不自动删除旧关系，不能视为全量源码同步。
