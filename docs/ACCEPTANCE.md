# dsh-explain 验收矩阵

本矩阵把 [PRD P0 验收标准](./PRD.md#验收标准) 映射到可重复执行的自动化证据。M2 真实模型与浏览器流程记录在 [PR #2](https://github.com/yuezengwu/dsh-explain/pull/2)，后续用户界面迭代的证据随对应 PR 保存；无密钥门禁不读取用户 `$DSH_HOME`，所有 Session、SQLite 和 profile 数据都位于测试临时目录。

## M39：DSH 0.2.1-rc.4 与 0.2.2-alpha.2（2026-10-29）

官方 tag 分别直接固定源码 `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` 和 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。M37 / M38 之后源码已补齐，本轮将两版加入支持清单，保留全部二十四个旧宿主及 SHA，扩至二十六版。开发发布包固定 alpha.2，协调 Cordis 4.0.6-alpha.1 / Schemastery 3.18.6-alpha.1、peer、引擎、CI 与锁文件；原始两版 store 均按协调 Cordis 最小安装后复现缺少 Zustand，只新增两个精确补丁并保留二十版旧修复。

alpha.2 默认发布依赖与独立 rc.4 发布依赖 profile 均通过 frozen install、兼容检查、类型检查、108 项测试、构建和实际 pack。两个精确源码各完成 frozen install 与完整 build，再分别通过链接检查、类型检查、108 项测试，并安装同一份 alpha.2 发布依赖 tarball 完成 8 Web、3 M6。覆盖学习视图、设置、来源导航、备份、清空、旧设置迁移及两次重启、快捷草稿、卸载、移除与重装。M6 实时停用/启用仍专属 0.1.6-alpha.2，其他宿主保持卸载/重装场景。完整二十六宿主 CI 与不可变安装证据随 PR / main run 保存。

alpha.2 的分页请求 `throughSeq` 变为可选、响应增加 `cursor`；夹具按 host 的固定切面补齐新响应，并继续要求 Explain 的观察器显式提交读取上限。业务源码和旧 golden 未改。与上次不可变 main CI 包比较，Host / Client 两份 bundle 字节相同，TypeRT 两份 bundle 各只差一行 DSH/Cordis 版本路径注释。官方 alpha.2 兼容检查器接受全部二十六版、拒绝未知 alpha.3，无豁免。alpha.2 宿主要求 Node >=24.9，本轮环境为 24.20.0。SQLite schema 4、backup v3、Explain 版本与标签保持不变；没有真实 provider、账号模型、Desktop、CUA、插件更新流程或 Session 降级通过结论。

## M38：npm alpha 0.2.2-alpha.2 的验证边界（2026-10-28）

CLI / store 的 npm `alpha` 升为 `0.2.2-alpha.2`，CLI `latest=0.2.1-rc.2` / `next=0.2.1-rc.4`、store `latest=0.1.2-alpha.2` / `next=0.2.1-rc.4` 不变。CLI 与二十三个配套 API 的新 alpha 元数据已核对，没有 `gitHead`；新 alpha 与 rc.4 的官方 tag / Release API 仍为 404，远端 tag 查询无匹配。因此两版均未接纳为 Explain 兼容宿主。

原始新 alpha store 改用 Cordis `~4.0.6-alpha.1`；配套 CLI / UI 包声明 Schemastery `~3.18.6-alpha.1`。全新临时项目按协调版本安装 store 与 Cordis 成功，随后独立 import 缺少 Zustand，manifest 仍把 Immer/Zustand 仅列为 devDependencies。官方 rc.3 的兼容检查器接受现有 rc.2 / rc.3，拒绝 rc.4 / 新 alpha，无豁免；没有实际运行新宿主。

本轮只修改五份文档，修正当前 alpha 标注，保留 rc.2 / rc.3 固定命令，以及全部二十四个旧源码 SHA、依赖、锁文件、精确补丁、peer 和引擎声明。兼容一致性、构建、实际 pack、当前提交与合并提交的完整 CI、默认 CLI 不可变 SHA 安装及四个 JavaScript 产物比对随本轮 PR 保存。新 alpha 的 fixed-source / Web / M6 验收仍待官方 tag；既有运行时证据保持 M36 原日期，没有新 Explain 标签、真实 provider 或 Desktop 通过结论。

## M37：npm next rc.4 的验证边界（2026-10-27）

CLI 与 store 的 npm `next` 已指向 `0.2.1-rc.4`，各自 `latest` 仍为 rc.2 / 0.1.2-alpha.2，`alpha` 仍为 0.2.1-alpha.5。CLI 和二十三个 API 包的固定 rc.4 元数据已核对；没有 `gitHead`。官方 rc.4 tag / Release API 返回 404，远端 tag 查询无匹配，因此本轮不宣称 rc.4 兼容，也不把它加入清单、引擎或 peer。

独立临时 npm 安装原始 rc.4 store 与 Cordis 4.0.5 成功，随后 import 仍缺少 Zustand；本项目继续固定 rc.3 开发依赖与已有精确补丁。已验证 rc.3 的官方兼容检查器复核现有 manifest：rc.2 / rc.3 接受，rc.4 拒绝，无豁免。该检查不作为 rc.4 宿主执行证据。

本轮只改五份文档，默认安装命令固定 rc.2，先前候选版固定 rc.3，明确禁止把命令换成尚待验证的 `@next`。二十四个固定源码宿主及 M36 的原始验收日期保留；当前提交 / 合并提交的完整 CI 与默认 CLI 不可变 SHA 安装结果随本轮 PR 保存。业务源码、依赖、锁文件、引擎、数据格式和 Explain 标签不变。待官方精确 tag 出现后继续兼容适配；没有 rc.4 发布包构建、固定源码、Web / M6、真实 provider 或 Desktop 的通过结论。

## M36：DSH 0.2.1-rc.3（2026-10-24）

固定官方源码 `1f81c047fc48fa190a683e469daa699857e9afe8`，保留二十三个既有宿主并扩至二十四版。开发发布依赖固定 rc.3，协调锁文件、精确 peer、`engines.dsh`、共享清单与 CI；Cordis `4.0.5`、Schemastery `3.18.5` 不变。CLI npm `latest=0.2.1-rc.2`、`next=0.2.1-rc.3`、`alpha=0.2.1-alpha.5`，中英文安装文档分别固定默认版与候选版。原始 rc.3 store 最小 npm 安装成功，独立 import 缺少 Zustand；追加精确版本补丁，保留全部十九版旧补丁。

发布依赖完成全新 frozen install、兼容一致性检查、类型检查、108 项测试、生产构建与实际 pack。固定源码完成 frozen install 与完整 build；源码链接检查、类型检查和同一 108 项测试通过。新宿主安装同一发布依赖 tarball，通过 8 项 Web、3 项 M6，覆盖学习视图、设置保存、来源导航、备份与清空、旧设置迁移及两次重启、快捷草稿、卸载、移除和重装。官方 rc.3 兼容检查器接受全部二十四版、拒绝未验收 rc.4，无版本豁免。完整二十四宿主与发布包 CI、合并和不可变安装证据随本轮 PR / main run 保存。

新增草稿选项保留原调用默认语义，新的 More 菜单不要求 Explain 改用新扩展点。业务源码、Host/Client bundle 哈希、旧 golden 不变，TypeRT 产物重新生成。SQLite schema 4、backup v3、Explain 版本与标签不变。本轮没有真实 provider、账号模型、API Key 适配器模型列表更新、Desktop 或 Session 降级读取验收。

## M35：npm 默认渠道指向已验证的 rc.2（2026-10-20）

CLI npm `latest=next=0.2.1-rc.2`，`alpha=0.2.1-alpha.5`；store 标签独立核对，`latest` 仍为 `0.1.2-alpha.2`。默认 CLI 与固定 rc.2 的 tarball URL、integrity、shasum 和版本一致，官方 rc.2 / rc.1 / alpha.5 / 0.2.0-rc.2 精确 tag SHA 未变。本轮更新五份文档中的当前渠道与默认安装说明；固定的 rc.2 安装命令保持可复现。二十三宿主清单、引擎、peer、依赖、锁文件、精确 store 修复和业务源码均沿用 M34。

兼容一致性检查复核全部版本及 SHA；发布包和固定源码的运行时验收沿用 M34 的原始日期。本轮当前提交与合并提交的完整 CI、官方 `@latest` CLI 在独立临时 Web profile 中按不可变 SHA 安装、四个 JavaScript 产物哈希比对结果随 PR / main run 保存。SQLite schema 4、backup v3、Explain 版本与标签保持不变；真实 provider、账号模型、Search/Fetch API、Desktop 与 Session 降级不在本轮验收范围。

## M34：DSH 0.2.1-rc.1 / rc.2（2026-10-18）

固定官方 rc.1 源码 `1600d8a1e140dcde43a1a0941940a0480712c011` 与 rc.2 源码 `687f282e8625c6b8d11ff58211a90524be2e4317`，保留二十一个既有宿主并扩至二十三版。开发发布依赖锁定 rc.2，协调 Cordis `4.0.5`、Schemastery `3.18.5`、锁文件、精确 peer、`engines.dsh`、共享清单与 CI。两个原始 store 发布包分别最小 npm 安装成功，独立 import 均缺少 Zustand；分别添加精确版本补丁，保留全部十七版旧补丁。CLI npm `latest=0.2.0-rc.2`、`next=0.2.1-rc.2`、`alpha=0.2.1-alpha.5`，渠道分别记录。

rc.2 发布依赖完成全新 frozen install、兼容一致性检查、类型检查、108 项测试、生产构建与实际 pack。两个固定源码各完成 frozen install 和完整 build；源码链接检查、类型检查及同一 108 项测试通过。两个源码宿主分别安装同一 rc.2 发布依赖 tarball，通过 8 项 Web、3 项 M6，覆盖学习视图、设置保存、来源导航、备份与清空、旧设置迁移及两次重启、快捷草稿、卸载、移除和重装。两个官方兼容检查器均接受全部二十三版，拒绝未验收的 rc.3，无版本豁免。完整二十三宿主与发布包 CI、合并和不可变安装证据随本轮 PR / main run 保存。

Explain 消费的 Session 分页、LLM、TypeRT 与界面扩展接口源码没有变化；业务源码、Host/Client bundle 哈希和旧 golden 不变。两个生成 TypeRT bundle 仅构建路径注释变化。SQLite schema 4、backup v3、Explain 版本与标签不变。本轮没有新增模型、Search/Fetch API、真实 provider、账号模型、Desktop 或 Session 降级读取验收。

## M33：DSH 0.2.1-alpha.5（2026-10-17）

固定官方源码 `1517a4dbca0a2789ff1d41ba439600f8547d23fa`，保留二十个既有宿主并扩至二十一版。更新 alpha.5 发布包、锁文件、精确 peer、`engines.dsh`、共享清单与 CI。新增精确 store 补丁，保留全部十六版旧补丁；原始发布包最小 npm 安装成功，独立 import 仍缺少 Zustand。Explain 不使用新增模型名称 Slot，业务源码与旧 golden 保持不变。

本地发布包完成全新 frozen install、兼容一致性检查、类型检查、108 项测试、生产构建和实际 pack。固定源码完成 frozen install 与完整 build；源码链接检查、类型检查和同一 108 项测试通过。8 项 Web 与 3 项 M6 安装同一发布依赖 tarball，覆盖学习视图、设置保存、来源导航、备份与清空、旧设置迁移及两次重启、快捷草稿、卸载、移除和重装。官方 alpha.5 兼容检查器接受全部二十一版，拒绝未验收的 alpha.6，无版本豁免。完整二十一宿主与发布包 CI、合并和不可变安装证据随本轮 PR / main run 保存。业务源码、Host/Client bundle 哈希和旧 golden 不变；SQLite schema 4、backup v3、Explain 版本与标签不变。没有真实 provider、账号模型、Desktop 或 Session 降级读取验收。

## M32：DSH 0.2.1-alpha.4（2026-10-16）

固定官方源码 `86a402200d95fecef4529d969836f1fe13c6cb0d`，保留十九个既有宿主并扩至二十版。协调 alpha.4 发布包、锁文件、精确 peer、清单和 CI；新增与清单完全一致的 `engines.dsh`，兼容检查拒绝遗漏或未验收版本。原始 store 最小 npm 安装成功，独立 import 仍缺少 Zustand；新增精确 alpha.4 补丁，原十五版补丁保留。Cordis/Schemastery 与 M31 相同，业务源码和旧 golden 不变。

本地发布包完成全新 frozen install、兼容一致性检查、类型检查、108 项测试、构建与实际 pack。固定源码完成 frozen install 与完整 build；源码链接检查、类型检查和同一 108 项测试通过。8 项 Web 与 3 项 M6 安装同一发布依赖 tarball，通过学习视图、设置保存、来源导航、备份与清空、旧设置迁移及两次重启、快捷草稿、卸载、移除和重装。直接运行新版官方兼容检查器，确认全部二十版可接受、未验收的 alpha.5 被拒绝，无版本豁免。完整二十宿主与发布包 CI、合并及不可变安装证据随本轮 PR / main run 保存。业务源码、Host bundle 与 Client bundle 哈希不变；SQLite schema 4、backup v3、Explain 版本与发布标签不变，无真实 provider、账号模型或 Desktop 验收，不声称 Session 降级可读。

## M31：DSH 0.2.1-alpha.3（2026-10-15）

官方 tag 直接固定源码提交 `2fbf4359b82fb94c03dcce0b831660d87f12ea5c`；CLI npm `alpha=0.2.1-alpha.3`，`latest=next=0.2.0-rc.2`。协调新 API、Cordis `4.0.5-alpha.2`、Schemastery `3.18.5-alpha.2`、锁文件、精确 peer 和 CI，保留十八个既有宿主的 SHA 与夹具能力，并新增第十九版。原始 store 包最小 npm 安装成功，独立 import 仍报缺少 Zustand；alpha.3 新增精确版本补丁，使用 manifest 中实际的 `immer: ^10.1.1` / `zustand: ~4.5.7`，原十四版补丁保持不变。

alpha.3 的 TypeRT 协议已拆分声明文件，Session/LLM/API 的声明合并需要明确归属。生成脚本复制五个已消费 SDK 的完整声明树，使用公开 analyzer/emitter 仅分析 Explain 的 Host face；新增官方 Remote helper 打入生成产物，不要求旧宿主提供 alpha.3 的 helper 入口。旧版 `schema` / 新版惰性 `create()` 访问仍共享同一个验证器。会话种子接受官方模块的命名 `apply`，alpha.3 的无密钥夹具经“添加 API Key → 稍后配置”及账号菜单进入设置；旧宿主路径保留。

本地发布包完成 frozen install、兼容一致性检查、类型检查、106 项测试、构建与实际 pack。固定源码完成 frozen install 与完整 build，链接检查、类型检查和 106 项测试通过；8 项 Web 与 3 项 M6 安装同一发布依赖构建的 tarball，覆盖学习界面、设置保存、来源导航、备份与清空、旧设置迁移及两次重启、快捷草稿、卸载、移除和重装。旧 golden 文件未改动。完整十九宿主与发布包 CI 以本轮 PR / main run 为准。业务源码及 Host bundle 哈希不变，SQLite schema 4、backup v3、Explain 版本与发布标签不变；本轮无真实 provider、账号登录/模型或 Desktop 验收，不声称新版 Session 文件可降级读取。

## M30：DSH 0.2.1-alpha.2（2026-10-10）

官方 annotated tag `6851e496285b2c9670066fdd142e7e46da586649` 固定源码提交 `d743267388641bc76f17c45ce8b4c231aed1d32c`；CLI npm `alpha=0.2.1-alpha.2`，`latest=next=0.2.0-rc.2`。协调发布 API 依赖、锁文件、共享清单、peer 和 CI，保留十七个既有宿主并扩至十八版。新版 Session plugin records 和 LLM 可选控制回调未要求 Explain 改用新 API，业务运行时保持不变。原始 store 发布包最小 npm 安装成功，独立 import 仍报缺少 Zustand；新版单独补齐 `immer: ^10.1.1` / `zustand: ~4.5.7`，此前十三个精确版本继续使用原补丁。

本地发布包完成 frozen install、兼容一致性检查、类型检查、106 项测试、生产构建与实际 pack。新固定源码构建成功，源码链接检查、类型检查与同一 106 项测试通过；8 项 Web 和 3 项 M6 安装同一份发布依赖构建的插件 tarball，通过旧设置迁移及两次重启、来源导航、快捷草稿、卸载、移除和重装。alpha.2 不运行 M6 实时启停分支；该分支继续仅在 `0.1.6-alpha.2` 执行，README 与兼容约定已据此纠正覆盖描述。完整十八宿主与发布包 CI 以本轮 PR / main run 为准；SQLite schema 4、backup v3、Explain 版本不变，无新标签、真实 provider、账号模型或桌面端验收，不声称新版 Session 文件可降级读取。

## M29：来源队列回收与兼容一致性（2026-10-09）

发布 API 依赖经 frozen install、类型检查、106 项测试、生产构建与实际 pack。固定 alpha 源码 `5badb15009ae1756c3afe0ae0cef1faafc290ccc` 通过源码链接检查、类型检查、同一 106 项测试，以及安装上述发布依赖 tarball 的 8 项 Web、3 项 M6。Web 含旧设置迁移及两次重启；alpha 的 M6 验证卸载后移除与重装，当前实时启停分支只在 `0.1.6-alpha.2` 执行，不把完整矩阵保留该用例解释为其他宿主的独立实时验收。共享清单保留全部十七个版本和 SHA，完整 CI 结果以本轮 PR / main run 为准。队列测量及原始合成样本见 [规模验证](./QUEUE_SCALE.md)；Node 22.19.0 额外通过兼容检查与源码链接检查，正式包/宿主 CI 使用 Node 24。用户学习库未读取或改写，仍为 schema 4 / backup v3，无新标签或真实 provider 验收。

## M28：DSH 0.2.1-alpha.1（2026-10-04）

npm `alpha` 的配套 API 发布包通过 frozen install、类型检查、90 项测试、构建和实际 pack。官方固定源码 `5badb15009ae1756c3afe0ae0cef1faafc290ccc` 通过类型检查、90 项测试、8 项 Web（含旧设置迁移及两次重启）和 3 项 M6（含实时停用/启用）；Web/M6 安装同一发布依赖构建的插件 tarball。此前十六个宿主由本次 PR CI 继续复核。新宿主移除了运行时 invariant 插件，Explain 不使用其入口，移除已停发的开发依赖即可。原始 alpha.1 store tarball 的最小 npm 导入仍缺少 Zustand，精确版本补丁扩至此版。本轮没有真实 provider、账号模型或桌面端测试，也不声称新版 Session 文件可降级读取。

## M27：DSH 0.2.0-rc.2（2026-09-30）

npm `latest` / `next` 的 rc.2 配套 API 发布包通过全新 frozen install、类型检查、90 项测试、构建和实际 pack。官方固定源码 `639ed015397290b3745d163aafe02ffee4aa3f84` 通过类型检查、90 项测试、8 项 Web（含旧设置迁移及两次重启）和 3 项 M6（含实时停用/启用）；Web/M6 安装同一发布依赖构建的插件 tarball。完整十六宿主矩阵由本次 PR CI 复核。原始 rc.2 store tarball 仍缺少 Zustand 运行依赖，因此仅扩展本仓库的精确版本补丁。此轮未验证真实 provider、账号模型或桌面端内置 CLI；不声称新版 Session 文件可降级读取。

## M26：DSH 0.2.0-rc.1（2026-09-29）

npm `next` 的 rc.1 配套 API 发布包通过全新 frozen install、类型检查、90 项测试、构建和实际 pack。官方固定源码 `4878cdabd87d4041bdaff61d04c966883b9fd07a` 通过类型检查、90 项测试、8 项 Web（含旧设置迁移和两次重启）及 3 项 M6（含实时停用/启用）；Web/M6 安装同一发布依赖构建的插件 tarball。新宿主的无标题 Session 在侧边栏显示「未命名」，测试改按 Session ID 定位，旧版定位保留。十五宿主完整矩阵由本次 PR CI 复核。原始 rc.1 `dsh-client-store` 发布包仍缺少 Zustand 运行依赖；本轮无真实 provider 或账号模型验收，不声称新版 Session 文件可降级读取。

## M24：DSH 0.1.7-rc.2（2026-09-25）

npm next 的 rc.2 发布包通过 frozen install、类型检查、90 项测试、构建和实际 pack。精确源码 `477b4f420553e8a52c2fbccc464d7561b239c443` 通过类型检查、90 项测试、8 项 Web（含旧设置迁移和两次重启）及 3 项 M6（含插件管理页实时停用/启用）；Web/M6 使用同一发布依赖构建的插件 tarball。新版设置页新增 DeepSeek Account 选项，由 rc.2 独立快照记录，旧宿主保留原快照。十四宿主完整矩阵由本次 PR CI 复核；本轮未验证账号模型或真实 provider。

## M23：DSH 0.1.7-rc.1（2026-09-24）

npm next 的 rc.1 发布包通过 frozen install、类型检查、90 项测试、生产构建和实际 pack。精确源码 `46a7f68b0922371ce7144b668b90e377d8e799f4` 通过类型检查、90 项测试、8 项 Web（含旧设置迁移与两次重启）和 3 项 M6（含插件管理页实时停用/启用），Web/M6 安装同一发布依赖构建的插件 tarball。十三宿主完整矩阵由本次 PR CI 复核；本轮不声称真实 provider 验收或新版 Session 文件可降级读取。

## M22：DSH 0.1.7-alpha.2 与 0.1.5-rc.3（2026-09-23）

npm alpha 发布包完成 frozen install、类型检查、90 项测试、生产构建和实际 pack。alpha.2 与 npm next rc.3 的官方固定源码宿主分别通过类型检查、90 项测试、Web（alpha.2 为 8 项，rc.3 为 7 项）和 3 项 M6；Web/M6 安装同一发布依赖构建的插件包。旧设置迁移与两次重启继续在新版宿主验收；Explain SQLite schema 4 / backup v3 不变。完整十二宿主矩阵和精确 SHA 见[兼容约定](./COMPATIBILITY.md)。本轮不进行真实 provider 验收。

## M21：DSH 0.1.7-alpha.1 兼容（2026-09-22）

新增 live Config / profile 设置适配、旧设置一次性迁移、Session V4 消息来源和工具结果兼容，以及新旧快捷图标适配。三项迁移回归覆盖旧文件保留、字段隔离、显式配置优先、重置不重复导入、失败可重试与取消。90 项单元/集成在十个固定宿主执行；真实 Web 在新 alpha 增加迁移及两次重启场景，旧宿主保留七个共有场景；M6 保留三项含实时停用/启用的验证。SQLite schema 4 和 backup v3 不变，精确提交与证据范围见[兼容约定](./COMPATIBILITY.md)。

## M20：DSH 0.1.6-alpha.2 客户端兼容（2026-09-18）

固定新源码 `ddefc45fbc7f8e46dd73185e68295696d1297887`，保留八个原有宿主。发布包类型检查发现 `sessions.open()` 已移除；来源跳转改走新版工作区导航，旧版继续使用原入口。Session slot reference 直接提供其 binding 的作用域，避免把 reference 当作 id 导致快捷草稿不可用；释放后的点击返回不可用。新增三项回归覆盖 reference generation、已释放引用、旧版已有草稿保护及新版来源跳转失败反馈，总数为 87 项。

新宿主通过 7 个真实组装 Web 场景与 3 个 M6 场景；M6 还在新版插件管理页实时关闭、启用插件，验证样式、学习入口及快捷操作消失与单份恢复，并读取恢复后的学习状态。产品快照期望不变。发布包仍复现 store 缺少 Zustand/Immer，精确版本补丁扩至五个受影响版本。当前 CI 固定九个源码宿主；本地验证范围及提交证据见[兼容约定](./COMPATIBILITY.md)。

此兼容修复包含于 v0.3.1，旧 v0.3.0 标签不包含它。本轮兼容验收未进行真实模型调用；下方 9 月 15 日模型验收保留原版本与范围。

## v0.3.0 真实辅助模型验收（2026-09-15）

在独立 home、空白会话和自建公开 TypeScript 样例中，使用 DSH `0.1.6-alpha.1` 与 `deepseek-official/deepseek-flash` 的 Messages 协议完成真实学习闭环。自动讲解、重讲、用户修正跨压缩保留、正确回忆判为 mastered、错误应用判为 forgotten、精确回答命令、backup v3 导出和确认式清空均通过。主 Agent 仍只有一轮回答；清空后学习表为空，路由、启用和自主额度保留。

为立即覆盖两种复习结果，只把隔离数据库的到期时间提前；模型输出未 mock。精确代码提交、输入、结果、截图、数据计数和验收范围见[完整记录](./REAL_MODEL_ACCEPTANCE.md)。这是一条公开样例的功能验收，不代表普遍教学效果或全部模型路由。发布 CI 中 rc.2 的 M6 初始化曾超时于只接受 `aria-selected=false` 的会话定位器；现在同时接受已选中/未选中的来源，并在真实组装 Web 中重复打开当前来源验证。产品快照与运行时代码未改变。

## M19：异步历史读取与目录链接修复（2026-09-15）

生产来源读取迁移到 `sessionController.page()`，保留八个精确宿主。新增四项分页回归覆盖固定截点、取消后的页面、停滞游标和旧版 chunk 记录；既有来源测试现在通过小页读取验证跨页定位、隐私排除和主历史不变。插件生命周期回归额外阻塞真实 command/observer 的历史响应，清空学习数据后释放，确认自动候选和手动请求均不会重建旧数据。测试总数为 84，Web 仍为 7，M6 仍为 3；快照期望未修改。

中英文 README 的文档与媒体改用完整 GitHub / raw URL，避免目录站转载时把相对路径解析到不存在的站内地址。该修复对重新同步 README 的目录生效，目录自身的抓取时间和全站链接重写仍由目录维护者控制。

## M18 当前宿主兼容门禁（2026-09-15）

0.1.6-alpha.1 发布包经精确版本 store 依赖修复，通过 frozen install、类型检查、80 项单元/集成、构建和 pack dry-run。八个固定源码宿主（七个既有版本与新增 0.1.6-alpha.1）分别通过类型检查、80 项测试、7 Web、3 M6 和构建；快照期望无需改写。设置快照显式等待保存请求完成，避免 revision 推送早于请求结束时误取“保存中”状态；该竞态曾造成 rc.2 CI 失败。新版 Web 输入区、侧边栏与设置调整未破坏 Explain 的学习视图和快捷草稿。独立 npm import 仍复现新版 store 缺少 Zustand。该轮保留的同步 Session 历史读取已在 M19 迁移；精确 SHA 与当前实现见 [兼容约定](./COMPATIBILITY.md)。

## M17 宿主兼容门禁（2026-09-11）

0.1.5-rc.2 发布包在精确版本依赖修复后，通过 frozen install、类型检查、80 项单元/集成、构建和 pack dry-run。七个固定源码宿主（0.1.2-rc.1、0.1.3-alpha.1/alpha.2、0.1.5-alpha.1/alpha.2/rc.1/rc.2）分别通过类型检查、80 项测试、7 Web 和 3 M6；既有视图和快捷入口保持原验收期望。独立 npm import 对照确认 store 依赖缺失在两个新 rc 仍存在，原 alpha.1 对照成功。精确提交和修复范围见 [兼容约定](./COMPATIBILITY.md)。

## M16 宿主兼容门禁（2026-09-10）

0.1.5-alpha.2 发布包在补齐该版本 store 遗漏的运行依赖后，通过 frozen install、类型检查、80 项单元/集成、生产构建和 pack dry-run；rc.1、0.1.3-alpha.1、0.1.3-alpha.2、0.1.5-alpha.1、0.1.5-alpha.2 五个固定源码宿主分别通过类型检查、80 项测试、7 Web 和 3 M6。最新宿主的外层面板重组与设置可访问名称更新均通过真实 Web 场景，无需修改 Explain 运行时或快照期望。独立 npm 最小复现对比 alpha.1 导入成功、alpha.2 导入失败，上游依赖缺失已报 [Discussion #6082](https://github.com/deepseek-ai/deepseek-harness/discussions/6082)。精确提交与修复范围见 [兼容约定](./COMPATIBILITY.md)。

## M15 宿主兼容门禁（2026-09-09）

0.1.5-alpha.1 发布包通过类型检查、80 项单元/集成、生产构建和 pack dry-run；rc.1、0.1.3-alpha.1、0.1.3-alpha.2、0.1.5-alpha.1 四个固定源码宿主分别通过类型检查、80 项测试、7 Web 和 3 M6。V3 来源回归在真实 Session 中追加系统提示词，断言其不进入 capsule、结束坐标一致且主会话消息不变；低版本继续运行原来源隔离断言。合成 V0 Web 日志通过宿主迁移器迁移，输入框定位明确覆盖两版原生文案。精确提交见 [兼容约定](./COMPATIBILITY.md)。

## M14 宿主兼容门禁（2026-09-08）

alpha.2 发布包通过类型检查、80 项单元/集成、生产构建和 pack dry-run；rc.1、alpha.1、alpha.2 三个固定源码宿主分别通过类型检查、80 项单元/集成、7 个 Web 场景和 3 个 M6 场景。精确 SHA 与 CI 链接见 [兼容约定](./COMPATIBILITY.md)。所有验收使用独立临时 home；无密钥夹具不证明真实模型教学质量。

## M13 学习闭环修复门禁（2026-09-05）

| 问题 | 当前证据 |
|---|---|
| idle 压缩失败后反复空转 | `learning-regressions.spec.ts` 断言失败后读取次数不持续增长，新活动后可以成功重试 |
| 历史分页隐藏待反馈卡 | store、client 与真实 Web 覆盖活跃卡早于 31 条关闭历史，不点击加载更多也可见 |
| 无关活跃内容或重讲 revisions 挤满上下文 | 在 8k 容量下，20 条长活跃讲解仍允许新主动请求；40 个旧 revision 后仍能成功生成第 41 个，原记录保留 |
| partial/forgotten 未反映学习状态 | 两种结果分别验证提示、卡片、统计、自主重新教学、旧题失效和再次掌握恢复 |
| 敏感自由文本过滤缺口 | `privacy.spec.ts` 覆盖模型请求、生成文本、私有摘要和旧数据导出；普通 URL/相对路径保留，旧库不被改写 |
| 单一概念只出回忆题 | 同一概念连续复习得到 recall→application→application→distinction，成功推进、失败重复 |
| 最新宿主兼容 | rc.1 发布包；rc.1/alpha.1 固定源码提交各 80 单元/集成、7 Web、3 M6，以及类型检查/生产构建；精确 SHA 见 [兼容约定](./COMPATIBILITY.md) |

M13 已随 [PR #33](https://github.com/yuezengwu/dsh-explain/pull/33) 通过 CI 并合入。无密钥组装与确定性模型替身证明控制流和宿主兼容，不作为真实模型教学效果结论。

## 原始 P0 验收映射

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 关闭零成本 | `scheduler.spec.ts` disabled 测试；assembled Web snapshot 验证 off 时历史只读和反馈按钮禁用 |
| 2 | 来源隔离 | `scheduler.spec.ts` 双来源单飞与同来源停放；`m2-core.spec.ts` latest-wins/source gate |
| 3 | 全局单飞 | `scheduler.spec.ts` 记录 adapter 最大并发为 1，并覆盖自主、重讲和压缩交错 |
| 4 | 反馈隔离 | `store.spec.ts` 只掌握被寻址 Explanation；`client.spec.tsx` 按实体提交反馈 |
| 5 | 跨会话掌握 | `m2-store.spec.ts` 已掌握 TopicKey 在另一来源提交时被抑制 |
| 6 | 重讲一致 | `scheduler.spec.ts` 恢复持久 rephrase 待办并追加同一 Explanation 的 revision 2 |
| 7 | 来源摘要可恢复 | `m2-store.spec.ts` 从 revision 1 私有摘要重建 rephrase target；Remote 分页剥离摘要和工具结果 |
| 8 | 自主预算 | `m2-store.spec.ts` 滚动 24 小时、跨重启占额；`scheduler.spec.ts` 失败重试计数且 rephrase/compaction 豁免 |
| 9 | Topic 标题新鲜度 | `m2-store.spec.ts` 新 revision 更新 Topic 标题与 revision，旧 entry 标题保持不变 |
| 10 | 不活跃压缩 | `scheduler.spec.ts` dirty closed 数据只压缩一次，成功后集合变 clean，且不占自主额度 |
| 11 | 压力压缩 | `scheduler.spec.ts` 先压缩再发送目标请求，并覆盖压缩失败时不占额、不发送目标请求 |
| 12 | 上下文有效 | `m2-core.spec.ts` 严格渲染/解析辅助上下文并证明来源观察不改变 `deriveMessages()` |
| 13 | 原始历史保留 | `m2-store.spec.ts` checkpoint 后原 Explanation 仍由分页返回 |
| 14 | 持久一致 | `store.spec.ts` 权限与活跃状态重启；`m2-store.spec.ts` 重启恢复预算、掌握、历史、coverage 与 ExplainContext |
| 15 | 迟到隔离 | `scheduler.spec.ts` 在途自主请求被 off 取消后不能提交；store lease 测试拒绝旧 generation |
| 16 | 并发反馈 | `store.spec.ts` 两标签竞争同一 revision 只有一个成功；不同来源反馈状态互不覆盖 |
| 17 | 故障透明 | `store.spec.ts` 损坏数据库和未知 schema 拒绝重置；route、模型和压缩失败由 plugin/scheduler 测试覆盖；`client.spec.tsx` 验证 DSH `RemoteResult` 传输失败进入可见错误状态 |
| 18 | 界面一致 | `client.spec.tsx` 当前来源优先和全局缓存；assembled Web snapshot 渲染另一来源活跃卡与全局 Context |
| 19 | 视图约束 | assembled Web snapshot 验证空白 Hero 无学习 Tab，已建立 Session 的学习视图保留 composer |
| 20 | 测试伴随 | `pnpm test`、`pnpm run test:web`、本地目录安装 smoke 与 PR #2 真实模型 GIF |

发布候选运行以下门禁：

```sh
pnpm run typecheck
pnpm test
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:web
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run test:m6
pnpm run build
DSH_SOURCE_DIR=/absolute/path/to/dsh pnpm run dsh:link:check
git diff --check
```

## M4 内测可控性

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 无文件配置启动 | `plugin.spec.ts` 从空 settings namespace 读取 revision 0，并通过一次 Remote 写入启用有效模型；assembled Web 从空 user section 保存设置 revision 1 |
| 2 | 无效路由不启用 | 既有 `setEnabled` route 测试与 `plugin.spec.ts` 的模型容量校验路径；失败结果不改变 settings revision |
| 3 | 设置并发收敛 | `plugin.spec.ts` 验证 stale expected revision 返回 `SETTINGS_STALE`，胜者保持；`client.spec.tsx` 验证冲突后刷新到权威 revision |
| 4 | 关闭保持历史 | P0 disabled 单元测试；assembled Web 在 off 状态展示两条活跃讲解且反馈禁用 |
| 5 | 额度透明 | 设置页 ARIA snapshot 显示已用/上限、恢复时间与压力；Scheduler 预算门禁继续覆盖重讲豁免 |
| 6 | 来源可达 | assembled Web 从学习卡调用公开 Session 服务，实际选中另一个持久来源 Session，再看到同一全局学习线程 |
| 7 | 来源删除降级 | assembled Web 同时预置一个不存在于 inventory 的来源，讲解保留并显示“来源会话不可用”，浏览器无未处理错误 |
| 8 | 宿主生命周期 | 两个 UI 入口均通过 `slots.inject()` 注册；`client.spec.tsx` 验证设置页/学习页共享引用计数式 store 和单一 watch 生命周期 |
| 9 | 主工作隔离 | M4 不新增 Session 事件、projection 或 prompt 注入；P0 `deriveMessages()` 不变测试继续通过 |
| 10 | 测试伴随 | `pnpm run typecheck`、48 个单元/集成测试、3 个 keyless assembled Web 场景、本地目录 link/pack 门禁与 PR 内真实模型 GIF |

## M5 主动学习命令

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 命令发现与兼容 | `plugin.spec.ts` 通过真实 command registry 断言 descriptor、input hint 和管理/请求共存；assembled Web snapshot 覆盖 composer slash discovery |
| 2 | 显式讲解 | `plugin.spec.ts` 从空白来源执行真实 `/explain <request>` 并得到带 `origin: manual` 的全局 active entry；`m2-core.spec.ts` 覆盖最近合格来源和 turn 0 捕获 |
| 3 | 严格输出与持久化 | `m2-core.spec.ts` 拒绝 skip、额外字段和非法 TopicKey；`m2-store.spec.ts` 证明 origin、私有来源摘要和重讲 revision 跨事务保留 |
| 4 | 单飞、门与取消 | `scheduler.spec.ts` 覆盖真实 LLM service 请求、来源 busy 快速失败、在途取消和单飞；store 事务复核来源、Topic 与 lease |
| 5 | 自主预算豁免 | `scheduler.spec.ts` 与 `m2-store.spec.ts` 断言主动生成和后续重讲不增加 `auto_request_usage` |
| 6 | 主 Agent 隔离 | command runtime 只写标准 command 生命周期；`m2-core.spec.ts` 的 source 捕获不改变 `deriveMessages()`，assembled 产品流程验证 composer 命令不形成主模型回答 |
| 7 | 产品证据 | `pnpm run typecheck`、`pnpm test`、`pnpm run test:web`、本地目录安装 smoke 和 PR 内真实模型 GIF |

## M6 P1 Explain 自有快捷入口

| # | 标准 | 自动化与产品证据 |
|---:|---|---|
| 1 | 单仓库所有权 | `test:m6` 的全新 profile 只安装 Explain，并断言 selection-chat、suggested-replies 与 Advisor 均不在配置中；源码不导入它们的包或私有状态 |
| 2 | 选区草稿 | `shortcuts.spec.tsx` 覆盖换行保留、10,000 字符上限和只写草稿；`test:m6` 在真实 DSH Web 中从可见文本生成精确 `--selection` 草稿 |
| 3 | 精确回答草稿 | assistant action 使用稳定 message id 从当前 snapshot 定位 turn；单元测试与 `test:m6` 断言生成精确 `--answer <turn>` 草稿 |
| 4 | 点击时准入 | `commitExplainDraft` 在每次点击重新读取 input facade，拒绝非 `plain`、非空草稿、Session 不可用和写入未生效；两个入口都不调用 `submit()` |
| 5 | 生命周期 | 两个 additive slot 均通过 `slots.inject()` 注册；`test:m6` 在 Web 卸载后删除整个 Explain 层，再安装时每项只恢复一次 |
| 6 | 来源兼容 | Host 对 selection 逆序定位；answer 精确读取 completed/max-tokens turn；旧 `--suggested` 输入与旧 `origin: suggested` 记录保持可读，新 UI 只生成 `answer` |
| 7 | Advisor 隔离 | Explain 不订阅 Advisor runtime；只有用户显式选择其可见 context 后才生成 `origin: selection`，未选择内容不进入 observation 或 ExplainContext |
| 8 | 成本与主 Agent 隔离 | 快捷入口本身零模型调用；用户提交后复用 manual Scheduler 且豁免自主额度，command 生命周期不进入主模型消息 |
| 9 | 真实产品流程 | 从精确候选提交启动全新 DSH Web，以真实主模型生成来源回答，再验证 answer/selection 草稿、真实 Explain 讲解与反馈闭环；GIF 随合入 PR 保存 |

## M7 v0.2 本地数据治理

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 导出版本稳定 | `store.spec.ts` 断言 format/version、schema/store revision、entries 顺序和 ExplainContext 投影 |
| 2 | 导出隐私边界 | `store.spec.ts` 断言 JSON 不含 private source、`sourceSummary`、完整 transcript 或绝对宿主路径 |
| 3 | 清除原子性 | `store.spec.ts` 覆盖清除计数、revision 递增、空线程/Context、stale CAS revision-neutral 与运行租约延续 |
| 4 | 成本上限不可绕过 | `store.spec.ts` 与 `scheduler.spec.ts` 断言清除前已占用的滚动 24 小时自主额度在清除后保留 |
| 5 | 在途隔离与恢复 | `scheduler.spec.ts` 在真实 LLM adapter in-flight 时执行清除，迟到结果不落库，队列清空且后续候选正常生成 |
| 6 | 设置保留 | `plugin.spec.ts` 经 typed Remote 清除后 provider/model/enabled、settings revision 与预算上限保持不变 |
| 7 | 显式破坏性确认 | Host 要求精确 `CLEAR`；设置页未输入前禁用按钮，`client.spec.tsx` 验证 revision 与确认词一起提交 |
| 8 | 测试伴随 | `pnpm run typecheck`、67 个单元/集成测试、assembled Web、M6 源码组合测试和生产构建 |

## M8 v0.3 复习闭环

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 迁移与首次到期 | `store.spec.ts` 把真实 v2 结构经 schema v3 迁移到 v4，并断言既有 mastered Topic 立即进入待复习 |
| 2 | 持久化三题 | `store.spec.ts` 断言单轮最多三题、固定 recall/application/distinction 顺序与 active round 恢复 |
| 3 | 语义评估单飞 | `scheduler.spec.ts` 通过真实 LLM service adapter 完成复习评估，断言全局最大并发 1 且不占自主额度 |
| 4 | 确定性排期 | `store.spec.ts` 断言掌握后从首次复习推进到 3 天，并保留结果、反馈与来源坐标 |
| 5 | 幂等与隐私 | `store.spec.ts` 覆盖 answer replay；v3 导出包含公开复习历史但仍不包含私有来源摘要、完整转录或绝对路径 |
| 6 | 清除一致性 | 清除事务先删复习请求、attempt、batch 与 state，再删除 Topic；清除 receipt 单独报告 review attempt 数 |
| 7 | 测试伴随 | `pnpm run typecheck`、70 个单元/集成测试、assembled Web、M6 组合测试和生产构建 |

## M9 可校正学习画像

| # | 标准 | 自动化证据 |
|---:|---|---|
| 1 | 可见且可追溯 | `m2-store.spec.ts` 断言对话偏好与 Topic 熟悉度投影携带 confidence、observation、Session/turn 来源；`client.spec.tsx` 验证可编辑呈现 |
| 2 | 固定优先级 | store 断言 explicit > correction > inference，低优先级覆盖显式失败且 revision-neutral |
| 3 | 幂等与并发 | 写入使用 request-id replay/fingerprint 与 store revision CAS；重复请求不增加 revision，冲突请求返回稳定错误 |
| 4 | 忘记后不复发 | forget 删除用户覆盖并设置推断时间水位；有效投影立即隐藏旧 checkpoint，控制层进入所有后续辅助请求 |
| 5 | 成本与主流程隔离 | 画像写入不调用 Scheduler、不增加 `auto_request_usage`，也不改变主 Agent 消息来源 |
| 6 | 数据治理 | backup v3 包含完整画像审计；`CLEAR` 同事务删除控制、suppression 与审计并单独计数 |
| 7 | 测试伴随 | `pnpm typecheck`、71 个单元/集成测试、rc.1 assembled Web 6/6、M6 组合 3/3、生产构建与 pack dry-run |
