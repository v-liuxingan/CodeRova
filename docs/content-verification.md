# 生成、检查与证据维护

模型按专项规范输出调用图 JSON 或 Mermaid＋元数据，程序负责渲染与诊断。

```powershell
npm run build:scenes
npm run check:content
npm run check:content -- --project qoreon
# 机器读取报告，直接运行 Node 避免 npm 的额外标题
node scripts/check_content.mjs --project qoreon --json
```

`--config <项目目录文件>` 与 Rust CLI 一致：相对 root 从配置文件所在目录解析。默认读取
callgraph.projects.json，不自动合并 local 文件。不存在的项目或空筛选失败。源码不在本机
时报告失败，不把跳过当成通过；静态页面仍可单独构建阅读。

检查按图聚合错误，不会因第一张图失败就省略其他诊断：调用图复用 Rust validate --json；
场景复用构建器的加载、归一化、校验和渲染。另检查同名元数据、基础跳转、页面/目录同步、
源码路径边界、文件、行范围、可选 anchor 与证据指纹。--project 只检查所选项目的页面，
完整目录同步使用不带筛选的检查。

JSON 报告包含 valid、graphs、scenes、locations、fingerprintMatches、diagnostics。
诊断包含 severity、code、file、field、message，Mermaid 错误保留文件和行号。
error 导致非零退出；warning 表示需注意或复核，info 提供覆盖信息。关联比例不是完整性
评分，不要求每条消息强制增加证据。

## 证据层次

场景 project.id 关联项目目录。evidence.status 可选 source/inferred：前者表示作者据源码
核对，后者明确是推断。未填时页面显示未标注。机器不会把这些类别提升为“已证明”。
location.anchor 可提供所选行范围内的字面片段；symbol 仍是给人看的名称，可含多个符号，
不当成跨语言解析表达式。调用图复用节点和精确边的位置；压缩/虚拟关系不会产生假指纹。

## 基线更新

首次核对关键结论、源码与引用后，显式建立该项目的基线：

```powershell
npm run evidence:snapshot -- --project qoreon
npm run check:content -- --project qoreon
```

提交 evidence/baselines/<project>.json。基线不保存源码正文、机器绝对路径或运行日志。
SHA-256 基于所引行范围并归一 CRLF；文件级依据覆盖整文件。同时保存归一化图内容摘要，
叙事变更也需复核。新/删除的依据、缺少基线有提示；已入基线的内容变化导致失败。
普通检查绝不更新基线，snapshot 也不会在结构、位置、锚点或页面同步失败时写入。

更新成功表示作者选择接受当前基线，不是机器证明业务结论；不要用 snapshot 自动消除
错误。所引范围外、动态行为和环境变化未必影响指纹，指纹不能发现全部语义失效。
revision 为可读背景，检查对象是当前工作区。Qoreon 本轮建立复核后的基线；历史 Codex
和项目自身样例保留“未建基线”提示，不能批量快照冒充重审。

scripts/check_content.mjs 负责编排和诊断，scripts/content/evidence.mjs 负责受限读取。
浏览器和 Rust API 不依赖基线，未新增远程源码服务。
