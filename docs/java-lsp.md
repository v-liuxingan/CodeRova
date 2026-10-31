# Java 调用图采集

Java 使用 Eclipse JDT LS 的标准 `prepareCallHierarchy` / `outgoingCalls`，Rust 使用
rust-analyzer。CLI 根据入口文件扩展名选择；页面续采根据图的 `analysis.provider` 选择。
Java 节点展示简短类名和方法参数，稳定身份仍使用语言服务器原始签名；同一方法的每个调用位置分别保留。
JDT LS 每次出向查询前重新 prepare 当前声明，清除上一个调用方的层级缓存，并使用方法声明
位置而不是 JavaDoc 起点；返回的调用点还须落在调用方方法
范围内，否则保留待采状态，拒绝将其他方法中的行号绑定到当前调用方。

## 本机配置

在启动服务的工作目录创建 `callgraph.lsp.local.json`（已被 Git 忽略），也可以通过
`CALLGRAPH_LSP_CONFIG` 指向配置文件。这里的命令与路径只有本机操作者可配置，浏览器不能提交。
路径建议使用绝对路径。安装目录、工作区缓存和 Gradle 缓存相互独立。

```json
{
  "java": {
    "command": "E:/tools/jdk-25/bin/java.exe",
    "args": [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Xmx2G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens", "java.base/java.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "-jar", "E:/tools/jdtls/plugins/org.eclipse.equinox.launcher_VERSION.jar",
      "-configuration", "E:/tools/jdtls/config_win",
      "-data", "{workspace}"
    ],
    "workspaceRoot": "E:/caches/jdtls",
    "settings": {"java": {"autobuild": {"enabled": false}}}
  }
}
```

`{workspace}` 由项目真实根路径的稳定标识生成，每个项目有独立缓存；`{root}` 可引用项目根。
同一工作区不要同时由两个服务进程使用，JDT LS 的工作区锁会拒绝并发打开。页面自身仍只允许
一个采集或入口校验任务运行。服务不安装 JDK，不修改全局 PATH。

JDT LS 负责 Maven/Gradle 工程导入，可能下载依赖及执行工程导入所需的构建逻辑；只对可信
项目运行。`settings` 按 JDT LS 原生格式传入。已有 Gradle 缓存可配置
`java.import.gradle.user.home`，以及 `java.import.gradle.offline.enabled=true` 和
`java.import.gradle.downloadSources=false`，减少网络等待。离线模式缺少依赖时会影响解析，
不是完整性保证。导入会产生 IDE 元数据，源码只读并不意味着源目录没有构建缓存。

## 生成与续采

```powershell
callgraph-visualizer analyze --project spring-framework `
  --file spring-context/src/main/java/org/springframework/context/support/AbstractApplicationContext.java `
  --line 581 --column 14 --max-depth 3 --request-budget 70 `
  --exclude-path spring-core/src/main/java/org/springframework/util `
  --output graphs/analysis/spring-context-refresh-lsp.json
```

`--server` / `--server-arg` 保留用于 Rust 服务覆盖；Java 启动统一使用本地配置。
初次导入最多等待 600 秒；Java 单次调用查询最多 180 秒，Rust 仍为 30 秒。预算按尝试采集的
方法数量计数，Java 为核对身份额外发送 prepare 请求，并非所有 JSON-RPC 消息的总上限。
超时保持该节点待采，不能把超时当成已证明的叶子。CLI 不覆盖已有文件。
首次索引较重，缓存会复用；服务进程目前每轮重新启动，不是常驻语言服务器池。

页面可从待采叶子继续采集，也可用 Java 文件选择器校验方法并创建人工关联入口。
停止会取消当前会话，保留此前已完成的检查点。通过草稿接口采集时只有“采纳并保存”写入
图文件；直接 `/analysis` 接口仍为持久采集，见 [AI 操作](ai-operations.md)。

## 能力边界与验收

- 只保留项目根内的可解析源码目标；JAR / JDK 目标记录在 issues，不递归采集依赖。
- Java 静态绑定保留声明方法；查询到的项目内实现以现有 `trait-dispatch` 关系列出，只有一个实现时自动继续，多个实现时等待选择。Spring AOP、反射、BeanFactory 动态
  获取和事件订阅不能仅靠调用层级证明，需另行提供源码依据或人工关联。
- 默认不执行构建产物或 Spring 应用；不能宣称获得运行时调用顺序或完整业务执行链。
- 手工 `spring-context-refresh` 图用于学习与对照；`spring-context-refresh-lsp` 是自动采集产物，
  两者的节点数不能直接当作完整度分数。

真实协议验收：`python -X utf8 tests/java_lsp_test.py`，通过
`CALLGRAPH_JAVA_TEST_BINARY` 指定已构建二进制。覆盖首次调用点、选行校验、草稿续采、
预览不落盘、保存和 V2 源码定位。无需 Spring 全量构建即可验证客户端基本协议。

本机验证环境：`spring-learning-env` 中的 Zulu JDK 25，JDT LS
`1.64.0-202610301801` 官方 snapshot，下载 SHA-256：
`3bff77299e7449ddec5466e1c600a5f221312b057240b06162b7d9326bb9ca5e`。
Snapshot 版本需固定，不在启动时自动升级。语言服务器未随本仓库分发。

2026-10-31 本机 Spring 验收：以 `AbstractApplicationContext.refresh()` 为入口，
深度 3、查询预算 70，自动产出 107 个节点、204 个调用点。70 个符号完成查询，
37 个待采节点中，22 个到达深度边界、13 个到达预算边界、2 个被显式路径规则排除；
本轮没有超时或调用点越界错误。这是有边界的首轮采集，不是完整度结论。
图文件约 184 KiB；热服务页面加载一次测得 0.85 秒，不能当作冷索引耗时或性能分位数。
Java 进程一次内存采样约 1.99 GB，并非峰值，首次索引仍需留出足够内存。
53 个 Rust 测试、Clippy、真实 Java 协议与草稿保存测试、Rust 草稿采集回归、
所有图文件校验和 Spring 源码指纹检查通过。全量前端门禁停在旧版
`edge_routing_test.mjs` 长时间未结束，不能记为全量 E2E 通过。

官方依据：[JDT LS 启动与能力](https://github.com/eclipse-jdtls/eclipse.jdt.ls)、
[Eclipse 下载目录](https://download.eclipse.org/jdtls/snapshots/)。

## 类型与多态选择

`analysis/java.rs` 独立封装 JDT 的 documentSymbol、implementation 和声明文本提取，按文件
缓存符号列表。`analysis/semantics.rs` 将可选语言能力转换成统一 symbol 和节点/边结果；
CLI、续采和入口校验复用它。存储与前端不解析 Java 源码，不根据 provider 拼装类型逻辑。
增加语言时先扩展适配器，不在采集循环、保存接口和渲染器中添加语言特判。

节点可选 symbol 区分 ownerKind（class/interface/abstract-class/enum/record）、ownerName、
modifiers 和 tags。Java 类型以 LSP 层级为边界，声明修饰符从移除注释和字面量的源码提取；
`Entity` 标签只表示存在同名源码注解，不证明它一定由 JPA 管理。未知类型保持未知，旧图仍可读取。

候选关系复用 trait-dispatch，不增加新的关系枚举。callSiteStatus=omitted-nodes，目标节点
保存方法声明位置，不伪造调用行号。默认保留所有服务器返回且在项目根内的候选，去重后列出，
本轮查询只有一个实现时自动入队，深度计为下一层并遵守预算与排除；多个实现不自动入队。判断在人工减枝过滤前完成，不能把删剩一个当成唯一实现。已有真实调用独立指向同一方法时，仍可沿该真实调用继续采集。
无 seed 的批量续采跳过仅有候选关系入边的节点。用户或 AI 可指定待采候选 nodeId 继续采集。单一实现被深度或预算截断后，也通过此入口继续。
候选可能包括测试源码，受当前索引与项目边界限制，不能把候选列表当作运行时实例集合。
查询失败写入 issues，不能解释为没有实现。重新查询后不得恢复已永久减枝的候选节点。

`python -X utf8 tests/java_polymorphism_test.py` 使用真实 JDT：接口两个实现、停止在候选、
显式续采其中一个、Record/抽象类/Entity、草稿删除与保存、前端源码定位。符号词法边界和
前端候选线型另有单元测试；原 Java 与 Rust 草稿采集验收继续保留。

本轮 Spring 复采验收：251 个节点、204 个静态调用点、145 条候选实现关系；
70 个已查符号、181 个待采符号。所有节点都有所属类型信息，新增候选未自动递归采集。
55 个 Rust 测试、Clippy、真实 Java 多态测试、Rust 草稿回归、亮暗主题与源码定位通过；
Spring 两图共 563 个源码位置通过校验及指纹检查。旧版 edge_routing_test 再次长时间未完成，
已停止本次测试进程；全量前端门禁仍未通过，不以新版专项验收替代该结论。
