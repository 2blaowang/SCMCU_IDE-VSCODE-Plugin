# SCMCU IDE for VS Code（SC8 系列单片机）

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.9.2-orange.svg)](https://github.com/2blaowang/SCMCU_IDE-VSCODE-Plugin/releases)

**仓库地址（国内建议走 Gitee）：**

| 平台 | 地址 |
|---|---|
| GitHub | https://github.com/2blaowang/SCMCU_IDE-VSCODE-Plugin |
| Gitee（国内镜像） | https://gitee.com/wangzhengyangsb/zhongweiscmcuidevscodecha |

在 VS Code 中编译 SC8F/SC8P 系列单片机工程（基于 SCMCU_IDE 的 MPLAB XC8/PICC 工具链），
支持芯片设置、芯片切换、编译器自动检测、错误跳转，生成与官方烧录器**校验值完全一致**的 `.scx` 烧录文件。
另内置 **SCMCU 编程器识别**（底栏实时显示型号）与**一键编译下载**（编译后自动烧录，已实烧闭环验证）。

## 功能

| 命令 | 说明 |
|---|---|
| `SCMCU: 编译` | 编译工程（自动读 .scw 的 Device/源文件顺序/配置字），生成 `.hex` + `.scx`，输出 **CfgCRC/CfgSum** |
| `SCMCU: 一键编译下载` | 编译成功后自动连接 SCMCU 编程器烧录（产物 `.scx` 交给烧录助手，见「一键编译下载」） |
| `SCMCU: 芯片设置` | 图形化配置 WDT/PROTECT/LVR_SEL/FCPU_DIV 等硬件选项，写回 .scw **并同步写入已有 .scx 配置字区**（单例窗口） |
| `SCMCU: 选择芯片型号` | 从 IDE 芯片库选择型号，更新 .scw 的 Device= |
| `SCMCU: 源文件管理` | 图形化列出/添加/移除/排序 `.scw` 的 `SourceFile=`（按钮或**拖拽**均可，顺序即编译顺序），即时写回工程文件 |
| `SCMCU: 配置编译器目录` | 手动指定 SCMCU_IDE 安装目录 |
| `SCMCU: 自动检测编译器` | 自动扫描常见安装路径/盘符/环境变量 `SCMCU_IDE_HOME` |
| `SCMCU: 设置芯片型号 / 设置配置字 (脱离 .scw)` | 输入框直接写工作区设置（scw-less 模式用） |
| `SCMCU: 启动` | 手动触发加载——找不到 .scw 时若弹窗选了「不加载」，之后用本命令启用 |
| `SCMCU: 规范化配置字` | 修复 scw-less 模式下配置字高位「串芯片」错误（一般加载后自动执行一次，见「配置字规范化」） |

**状态栏**：

- 底部**左侧**按钮组（点击即用）：`$(chip)` 型号(点击切换) ・ `$(settings-gear)` 芯片设置 ・ `$(debug-start)` 构建 ・ `$(zap)` 编译下载 ・ `$(files)` 源文件
- 底部**右侧**：编程器识别（`$(circuit-board) WRITER8 LITE`；点击立即刷新，窗口聚焦时 5s 自动轮询，见「编程器识别」）
- 找不到 `.scw` 时右下角弹「加载」通知（仅一个按钮，约 20s 无操作自动消失 = 本次不加载；`scmcu.noScwBehavior` 可改为直接加载 / 永不加载）
## 使用

1. 用 VS Code 打开包含 `.scw` 工程文件的文件夹
2. 首次使用执行 `SCMCU: 自动检测编译器`（或 `SCMCU: 配置编译器目录`）
3. 执行 `SCMCU: 编译` —— 产物在 `build/` 下：
   - `<输出名>.hex`：Intel HEX 程序文件
   - `<输出名>.scx`：烧录文件（含配置字 + 程序，可直接用 SCMCU_Writer 烧录）
4. 改硬件选项（LVR 电压、WDT 等）→ `SCMCU: 芯片设置` → 选择 → 保存
5. 芯片切换 → 点击状态栏芯片型号 → 选择
6. 管理要编译的源文件 → 点击状态栏「源文件」或执行 `SCMCU: 源文件管理` → 添加 / 移除 / 上移下移（顺序即编译顺序，不可随意打乱）

## 脱离 .scw 编译（无工程文件模式）

适用于手上只有一堆 `.c/.asm/.s` 源码、没有官方 `.scw` 工程文件的场景。插件**不再强依赖 `.scw`**，改为从设置读取芯片型号与配置字、自动扫描源文件。

前提（设置 `settings.json` / 扩展设置页「SCMCU」，**或**用命令面板直接填）：

- `scmcu.device`（**必填**）：芯片型号，如 `"SC8F052A04"`。留空则编译报错提示先配置。
- `scmcu.configWords`（**建议填**）：4 个配置字（十六进制字符串数组），如 `["0x1FFF","0x3FFF","0x3FFF","0x3FFF"]`。
  **留空则用芯片默认未编程值**，编译时给出 ⚠️ 警告——烧录前务必核对硬件选项（振荡器/看门狗/LVR 等），否则固件可能不工作。
- `scmcu.sourceFiles`（**可选**）：源文件清单（相对工程根目录，顺序敏感）。`[]`（默认）= 自动扫描工程下所有 `.c/.asm/.s`；非空 = 按数组顺序编译。**优先于自动扫描**。可通过状态栏「源文件」/ 命令面板的「源文件管理」面板维护。

> 若扩展设置页里找不到这些条目（多为装了旧版 / 装完没重载窗口），可直接用命令面板：
> - `SCMCU: 设置芯片型号 (脱离 .scw)` —— 输入框填型号，写入「工作区设置」
> - `SCMCU: 设置配置字 (脱离 .scw)` —— 输入框填 4 个配置字（逗号分隔），写入「工作区设置」

行为：

- 打开含源码的文件夹后，只要设置了 `scmcu.device`，状态栏即出现「**芯片型号**（点击改型号 / scw 模式下切库）」+「**芯片设置**」+「**构建**」+「**源文件**」四个按钮。`.scw` 存在时面板写回 `.scw`；不存在时写回对应工作区设置。
- 源文件 = 若 `scmcu.sourceFiles` 非空，按其顺序编译；否则自动扫描工程下全部 `.c/.asm/.s`（排除 `build/`、`node_modules/`、`.git/` 等），按字母序。
  **注意**：XC8 的 psect 分配依赖编译顺序，若默认字母序导致链接异常，**用「源文件管理」面板维护一个有序清单写入 `scmcu.sourceFiles`**，或继续用 `.scw` 的 `SourceFile=` 精确控制顺序。
- 产物同样是 `build/<name>.hex` + `build/<name>.scx`，编译参数与 CfgCRC/CfgSum 输出与 `.scw` 模式一致。

## 配置字规范化（防串芯片）

14-bit 芯片（SC8F052 等，未编程值 `0x3FFF`）的工程，若工作区 `scmcu.configWords` 是从 16-bit 芯片
（SC8F072 等，`0xFFFF`）工程整体复制过来的，会出现**高位错误**（典型：`FFFB,FAEF,FFFF,FFFF`，
应为 `3FFB,3FEF,3FFF,3FFF`），烧进芯片后硬件选项错乱。插件内置两层防护：

- **自动**：加载工程时若同时满足「无 `.scw` + 已设 `scmcu.device` + 已手填 `scmcu.configWords`」，
  自动执行一次规范化——**有变化**才写回 `scmcu.configWords`（并尽力同步 build 目录 .scx）+ 提示
  before → after；已正确 / 未编程工程**静默跳过**。同一工作区只自动执行一次，想再跑用下面的命令。
- **手动**：`SCMCU: 规范化配置字`。

规则（核心 `normalizeConfigWordsCore`，src/chip.ts）：

- 芯片配置模板 `mcu/config/<chip>.cfg` **已定义**的位（硬件选项覆盖位）→ 保留基底当前值
- **未定义**的固定位 → 按芯片位宽复位到未编程值（**幂等**：重复执行结果不变）
- 末尾统一按芯片位宽清高位（`& hexmcu`）
- 纯 16-bit 芯片（hexmcu=`0xFFFF`）**只做位宽 mask、不重置未定义位** → SC8F072 的 `FAEF`
  （bit4/8/10=0 的隐藏位）不会被误改成全 1

芯片位宽来源：优先 `.ini` 的 `HEXMCU`；缺省时按型号兜底（`resolveHexmcu`：SC8F05x/SC8F070 等
14-bit → `0x3FFF`；SC8F072+、FC*/SC8P* → `0xFFFF`）。

## 构建输出示例

```
[SCMCU] 芯片: SC8P052B  ROM: 1024 word
[SCMCU] 源文件(8): main.c interrupt.c motor.c key.c LED.c battery.c CMP.c sleep.c
[SCMCU] include: src | inc | data/include
[SCMCU] 配置字: 3FF3,3FAB,3FFF,FFFF
[SCMCU] 烧录文件: ...\build\SCMCU_Project.scx (2304 字节)
[SCMCU] CfgCRC(Hex) -- 0x9202  CfgSum(Hex) -- 0x156D
[SCMCU] ✅ 构建成功
```

## 与烧录器校验值完全一致（CfgSum / CfgCRC）

插件生成的 `.scx`，用官方烧录器 SCMCU_Writer 打开显示的 **CfgSum / CfgCRC 与插件计算完全一致**。
算法直接对应烧录器核心库 `Writer.Core.dll` 反编译出的 **`GetCheckSum` / `GetDataCRC16`** 两个函数：

```csharp
// GetDataCRC16:  GetCRC16L_1021_FFFF_0000(0xFFFF, romDatas + bootRom + GetConfigByteDatas())
// GetCheckSum:   num2 += ConfigDatas[i] & 0xFF;  if (McuType==CMSCore) num2 += ConfigDatas[i] >> 8;
```

```
CfgSum = (Σ 程序区字节 [0x100,end) + Σ 前 N 个配置字 [低字节 + (CMSCore ? 高字节 : 0)]) & 0xFFFF
CfgCRC = CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, xorout=0)，对 [程序区字节 + 前 N 个配置字槽低+高字节] 计算
N      = 该芯片的配置字数量（参与校验和的槽数）
```

> `.scx` 配置区**定长 4 槽**（buildScx 写死 8 字节），但烧录器按**芯片数据库的配置字数量**只取前 N 槽：
> SC8F052 = 2 槽、SC8F072 = 4 槽。**N 以 `CFG_WORD_COUNT` 实测表为准**，不能看 `.scw` 列了几个——`.scw` 的
> `config=` 会用 `FFFF` 补齐到 4 个（如 SC8F052 的 `3FFB,3FEF,FFFF,FFFF` 实际只有 2 个字）。未收录芯片
> 由 build 从芯片配置模板 `mcu/config/<chip>.cfg` 推导（最大 word 索引 + 1）兜底，最后默认 4。
> 早期「只计连续非 0xFFFF 槽」的算法对 SC8F072（槽 0=FFFF）数成 0 槽算错；硬编码 4 槽又让 SC8F052 算错。

实测样本（已用官方烧录器 SCMCU_Writer 显示值逐位核对）：

| 工程 | 芯片 | 配置字 | N | CfgSum | CfgCRC |
|---|---|---|---|---|---|
| test1 | SC8F052 | 3FFB,3FEF | 2 | A5AE | 20CD | ✓ 与烧录器一致（2 槽） |
| test2 | SC8F052 | 7FFF,FFEF | 2 | AA75 | 9665 | 旧算法样本（同为 2 槽，规则一致） |
| test3 | SC8F072 | FFFF,FAEF,FFFF,FFFF | 4 | 4619 | EC0D | ✓ 与烧录器一致（4 槽） |

> 新芯片接入：若某芯片烧录器显示的 CfgSum/CfgCRC 与插件不符，先确认该芯片的配置字数量与是否 CMSCore
> （非 CMS 内核只加配置字低字节），把芯片名补进 `src/scx.ts` 的 `CFG_WORD_COUNT` / `NON_CMS_CORE` 即可。

## 编程器识别（底栏右侧）

按官方 SCMCU_Writer 的 `Writer.Core.dll`（反编译）设备表，识别 Windows 下已连接的 SCMCU 编程器
（USB HID，**VID 0x1209**），底栏右侧实时显示型号并区分正常 / 升级(bootloader) 模式：

| 型号 | 正常 PID | 升级(bootloader) PID |
|---|---|---|
| WRITER8 LITE | 0x0201 | 0x0101 |
| WRITER V8 | 0x0032 | 0x0011 |
| WRITER V8 PRO | 0x0023 | 0x0021 |
| ICE8 PRO | 0x1502 | 0x1102 |

- 加载后立即检测一次；VS Code 窗口**聚焦时每 5 秒轮询**（USB 枚举约 1s/次，失焦自动停表，避免后台空耗 CPU）
- 点击状态栏立即刷新并弹结果；Tooltip 含 PID / 模式；升级模式显示 `(Boot)` 并提示用 Writer 升级功能刷固件
- 未连接 → `编程器: 未连接`；识别失败 → `编程器: 检测失败`；未知 PID → 「未知编程器」（便于将来新硬件）
- 实现（src/programmer.ts，纯 Node 可单测）：优先 `pnputil /enum-devices /connected /deviceids`，失败回退 `Get-PnpDevice`；仅 Windows 生效

## 一键编译下载（编译 → 自动烧录）

前置：本机装有官方 **SCMCU_Writer**（编程器上位机），已用 USB 连接编程器、座上放好芯片。

插件编译出 `.scx` 后，spawn 内置烧录助手 `flash/ScmcuFlashHelper.exe` 完成烧录，全程**无需打开 Writer GUI**。
助手引用 Writer 自带的 `Writer.Core.dll`（`AssemblyResolve` 动态加载，不污染安装目录），复用其加密
芯片库（SQLite，口令 `cmsxc`）与 USB HID 协议，时序与 Writer GUI 完全一致：

```
编译 → .scx → 连接编程器(版本握手/WriterID 校验)
     → 0x61 信息帧1(Series/Type/段长/WriterCount/CRC32) → 0x21 芯片名+注解
     → ROM/Config/EE 分段下发(57B/块，逐块等 ACK) → 0x60 整段 CRC 校验 → 0x50 结束(可复位运行)
```

- 入口：命令 `SCMCU: 一键编译下载`；底栏左侧 `$(zap) 编译下载` 按钮（构建按钮旁）
- `scmcu.writerPath`：Writer 安装目录；**留空自动扫描**（盘符根 / `Work` / `Program Files` /
  `gat/sheet/中微` 下含 `library`+`data` 的 `SCMCU_Writer*` 目录）
- `scmcu.flashCount`：烧录片数（WriterCount），默认 1
- 出错场景均有明确中文报错：编程器未连接 / 型号不支持该芯片 / 芯片库无此型号 / 文件解析失败
- 助手 `--probe` 模式只验证链路（连接→芯片库→.scx 解析）**不烧录**，用于排障
- 助手依赖：x86 / .NET Framework 4.x（Win7+ 自带）；无 .NET SDK 的机器用 `python flash/build_helper.py`
  从 NuGet 拉 Roslyn 一键重编（见「开发」）

## 设置项（settings.json）

| 键 | 说明 |
|---|---|
| `scmcu.compilerPath` | SCMCU_IDE 的 `data\bin` 目录（含 picc.exe），留空自动检测 |
| `scmcu.idePath` | SCMCU_IDE 安装根目录（含 `mcu\config`），留空自动检测 |
| `scmcu.buildDir` | 编译输出目录，默认 `build` |
| `scmcu.outputName` | 产物文件名，默认 `SCMCU_Project` |
| `scmcu.sourceDirs` | **C 源文件目录**（相对工程根目录；空串 = 根目录），默认 `["src"]` |
| `scmcu.includeDirs` | **头文件 include 目录**（相对工程根目录；空串 = 根目录），默认 `["inc"]`，编译时加入 `-I` |
| `scmcu.device` | **脱离 .scw 模式必填**：芯片型号，如 `"SC8F052A04"`；留空则该模式编译报错 |
| `scmcu.configWords` | **脱离 .scw 模式建议填**：4 个配置字（十六进制字符串数组），如 `["0x1FFF","0x3FFF","0x3FFF","0x3FFF"]`；留空则用芯片默认未编程值（编译时警告） |
| `scmcu.sourceFiles` | **脱离 .scw 模式可选**：源文件清单（相对工程根，顺序即编译顺序）；`[]` = 自动扫描（用「源文件管理」面板维护） |
| `scmcu.noScwBehavior` | 找不到 `.scw` 时的行为：`prompt`（默认，右下角询问）/ `load`（直接加载）/ `skip`（不加载，可手动 `SCMCU: 启动`） |
| `scmcu.writerPath` | SCMCU_Writer 安装目录（一键编译下载用）；留空自动扫描，见「一键编译下载」 |
| `scmcu.flashCount` | 一键下载烧录片数（WriterCount），默认 `1` |

## 错误跳转（Problem 面板）

编译时 picc 输出的错误/警告会解析到 VS Code「问题」面板（`--errformat` 格式化为机器可读格式），
点击即可跳转到对应源文件行号。编译输出仍保留在「SCMCU」输出面板。

## 工作原理（与 IDE 一致性的保证）

- **源文件顺序**：按 `.scw` 的 `SourceFile=` 行顺序编译——XC8 的 psect 分配依赖编译顺序，顺序不同产物不同（实测字母序 vs IDE 顺序差异 504 处）。
- **编译参数**：与 IDE 完全一致（从 IDE 生成的 `startup.as` 头部提取）：`--fill=0xFFFF --output=intel -D__DEBUG=1 -g --asmlist --warn=-9 --runtime=default, --opt=-local,-asmfile,+asm,-speed,+space,-debug --stack=compiled:auto:auto:auto --addrqual=request --mode=pro`。
- **配置字**：从 `.scw` 的 `config=` 行读取（IDE 权威值，含模板外隐藏位规则），写入 `.scx` 头 0xA0 起的 4 个 16 位槽位。
- **芯片参数**：从 IDE 的 `mcu/ini/<chip>.ini` 读取 `ROMSIZE`（程序区大小）、`HEXMCU`（未编程 word 值）。
  `.ini` 缺 `HEXMCU` 时按型号兜底（14-bit SC8F05x/SC8F070 → `0x3FFF`，其余 16-bit → `0xFFFF`），配置字计算末尾统一 `& hexmcu` 按位宽清高位。
- **`.scx` 头部**：芯片名 + `!`（烧录器靠 `!` 识别固件，8 字符芯片名如 SC8P052B 不会截断 `!`）。

## 项目结构

```
src/
├── extension.ts         # 扩展入口：命令注册 + 状态栏 + 自动规范化 / 编程器 / 烧录接线
├── build.ts             # 编译编排 + 错误诊断解析 + CfgCRC/CfgSum 输出
├── chip.ts              # .scw 解析、芯片列表、cfg 模板、配置字计算/规范化核心（normalizeConfigWordsCore）
├── compiler.ts          # 编译器目录查找（配置/常见路径/盘符/环境变量）
├── scx.ts               # .scx 生成 + 校验值计算
├── programmer.ts        # 编程器识别（USB HID VID 0x1209；纯 Node，可单测）
├── flash.ts             # 一键烧录：Writer 目录探测 + spawn 烧录助手
└── webview/
    ├── hardwareOptions.ts  # 芯片设置面板（单例）
    └── sourceManager.ts    # 源文件管理面板（按钮/拖拽排序）
flash/
├── ScmcuFlashHelper.cs  # 烧录助手源码（net40/x86，引用 Writer.Core.dll，AssemblyResolve 加载依赖）
├── ScmcuFlashHelper.exe # 助手编译产物（gitignore 忽略，可 build_helper.py 重编）
└── build_helper.py      # 无 .NET SDK 机器一键重编助手（NuGet 拉 Roslyn Toolset）
test/
├── configWords.regression.js  # 配置字回归（15 断言，驱动 out/chip.js 真实实现）
├── programmer.regression.js   # 编程器识别回归（17 断言，纯函数层）
└── fixtures/ide/mcu/          # 从 SCMCU_IDE 拷入的芯片模板 .cfg/.ini（模拟 <idePath>，来源见 fixtures/README.md）
images/icon.png            # 扩展图标
```

## 开发

```bash
npm install          # 安装依赖
npm run compile      # TypeScript 编译
npm test             # 回归测试（配置字 15 + 编程器 17 断言；跑 out/chip.js 真实实现 + test/fixtures
                     #   模拟 IDE 芯片数据，不需要本机安装 SCMCU_IDE）
npm run package      # 打包 .vsix（scmcu-vscode-<version>.vsix）
```

F5 调试：打开本目录，按 F5 启动扩展开发宿主。

烧录助手重编（本机无需 .NET SDK，脚本自动从 NuGet 拉 Roslyn Toolset 4.8）：

```bash
python flash/build_helper.py   # 产物 flash/ScmcuFlashHelper.exe（x86 / .NET Framework 4.x）
```

> 测试夹具 `test/fixtures` 从官方 SCMCU_IDE 的 `mcu/{config,ini}` 拷入（SC8F052 / SC8F072 模板），
> 来源与更新方式见 `test/fixtures/README.md`。

## 版本历史

- **v0.9.2** — ① **底栏按钮精简**：芯片设置/源文件/构建/编译下载四个操作按钮改为纯图标，悬停提示精简为短文案（编译并下载到编程器 / 芯片设置 / 管理源文件 / 编译）；② **烧录助手补 wafer 修调数据下发**：按官方 `Run.StartDownload` 时序，在 0x60 校验前下发 `writer.fdat` 的 wafer 修调数据（Series 无数据自动跳过），为 FLASH 系列芯片脱机烧录兜底（SC8F072 全流程下载已验证）
- **v0.9.1** — ① **脱机烧录「找不到芯片」修复**：一键下载时写入正确的脱机选项 OfflineOption0/1（POWER=0，即官方默认 0xE8/0xE0），不再误用全局默认 0xFF（POWER=7），修掉「插件下载后按编程器烧录键找不到芯片」；② **脱机烧录「烧写次数不足」修复**：烧写次数上限默认改为无限（0=无限），`scmcu.flashCount` 设正整数可作量产限次；③ **源文件管理器死循环修复**：面板增删/排序改为整体覆写 `.scw` 的 SourceFile 段，在目录里删除源文件后也能正常从面板移除失效条目，不再报「源文件集合与 .scw 不一致」卡死
- **v0.9.0** — ① **配置字规范化**：每芯片 HEXMCU 兜底表 + 配置字位宽 mask + `SCMCU: 规范化配置字`，scw-less 加载时自动执行一次，修复从 16-bit 工程串来的高位错误（SC8F072 隐藏位有 fullWidth 守卫不误改）；② **编程器识别**：底栏右侧实时显示 SCMCU 编程器型号（PID 表来自 Writer.Core 反编译，聚焦 5s 轮询，升级模式标注 Boot）；③ **一键编译下载** `SCMCU: 一键编译下载` / 底栏 `$(zap) 编译下载`：spawn 烧录助手（引用 Writer.Core.dll 芯片库 + USB HID 协议）走 0x61/0x21/分段下发/0x60 校验/0x50 结束全时序，真机实烧闭环验证通过（SC8F052 含 EE 段）；④ 回归测试 `npm test`（15 + 17 断言）
- **v0.8.4** — 脱离 .scw 模式下面板全可用：状态栏「芯片设置」「源文件」两按钮在 scw / scw-less 两种模式都显示；芯片设置面板写 `scmcu.configWords`、源文件面板维护 `scmcu.sourceFiles`（可控制编译顺序）；新增 `SCMCU: 设置芯片型号/设置配置字` 命令面板入口
- **v0.8.3** — 命令面板新增 `SCMCU: 设置芯片型号/设置配置字 (脱离 .scw)`，用输入框直接写工作区设置；`engines.vscode` 从异常的 `^1.134.0` 修正为 `^1.85.0`，避免旧版 VS Code 判为不兼容
- **v0.8.1** — 新增「源文件管理」面板：可视化添加/移除/排序 `.scw` 的 `SourceFile=`
- **v0.7.0** — 插件图标；（之前各版为迭代开发，功能见上文）
- **v0.6.x** — 可配置源码/头文件目录、错误跳转、CfgCRC/CfgSum 与烧录器一致、SC8P 系列 8 字符芯片名修复
- **v0.3.x** — 芯片设置单例窗口、状态栏芯片切换与构建按钮
- **v0.1.x** — 基础编译 + 硬件选项配置 + 编译器自动检测
