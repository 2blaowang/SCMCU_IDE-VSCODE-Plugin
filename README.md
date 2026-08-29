# SCMCU IDE for VS Code（SC8 系列单片机）

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.8.4-orange.svg)](https://github.com/2blaowang/SCMCU_IDE-VSCODE-Plugin/releases)

**仓库地址（国内建议走 Gitee）：**

| 平台 | 地址 |
|---|---|
| GitHub | https://github.com/2blaowang/SCMCU_IDE-VSCODE-Plugin |
| Gitee（国内镜像） | https://gitee.com/wangzhengyangsb/zhongweiscmcuidevscodecha |

在 VS Code 中编译 SC8F/SC8P 系列单片机工程（基于 SCMCU_IDE 的 MPLAB XC8/PICC 工具链），
支持芯片设置、芯片切换、编译器自动检测、错误跳转，生成与官方烧录器**校验值完全一致**的 `.scx` 烧录文件。

## 功能

| 命令 | 说明 |
|---|---|
| `SCMCU: 编译` | 编译工程（自动读 .scw 的 Device/源文件顺序/配置字），生成 `.hex` + `.scx`，输出 **CfgCRC/CfgSum** |
| `SCMCU: 芯片设置` | 图形化配置 WDT/PROTECT/LVR_SEL/FCPU_DIV 等硬件选项，写回 .scw **并同步写入已有 .scx 配置字区**（单例窗口） |
| `SCMCU: 选择芯片型号` | 从 IDE 芯片库选择型号，更新 .scw 的 Device= |
| `SCMCU: 源文件管理` | 图形化列出/添加/移除/排序 `.scw` 的 `SourceFile=`（顺序即编译顺序），即时写回工程文件 |
| `SCMCU: 配置编译器目录` | 手动指定 SCMCU_IDE 安装目录 |
| `SCMCU: 自动检测编译器` | 自动扫描常见安装路径/盘符/环境变量 `SCMCU_IDE_HOME` |

**状态栏**（底部左侧）：

```
$(chip) SC8F072   $(settings-gear) 芯片设置   $(debug-start) 构建
  点击切换芯片        点击打开设置面板            点击开始编译
```

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
| Demo - 3.5Khz（报警器） | SC8F052 | 3FFB,3FEF | 2 | A5AE | 20CD | ✓ 与烧录器一致（2 槽） |
| test | SC8F052 | 7FFF,FFEF | 2 | AA75 | 9665 | 旧算法样本（同为 2 槽，规则一致） |
| OSND-TC011-A-V10 | SC8F072 | FFFF,FAEF,FFFF,FFFF | 4 | 4619 | EC0D | ✓ 与烧录器一致（4 槽） |

> 新芯片接入：若某芯片烧录器显示的 CfgSum/CfgCRC 与插件不符，先确认该芯片的配置字数量与是否 CMSCore
> （非 CMS 内核只加配置字低字节），把芯片名补进 `src/scx.ts` 的 `CFG_WORD_COUNT` / `NON_CMS_CORE` 即可。

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

## 错误跳转（Problem 面板）

编译时 picc 输出的错误/警告会解析到 VS Code「问题」面板（`--errformat` 格式化为机器可读格式），
点击即可跳转到对应源文件行号。编译输出仍保留在「SCMCU」输出面板。

## 工作原理（与 IDE 一致性的保证）

- **源文件顺序**：按 `.scw` 的 `SourceFile=` 行顺序编译——XC8 的 psect 分配依赖编译顺序，顺序不同产物不同（实测字母序 vs IDE 顺序差异 504 处）。
- **编译参数**：与 IDE 完全一致（从 IDE 生成的 `startup.as` 头部提取）：`--fill=0xFFFF --output=intel -D__DEBUG=1 -g --asmlist --warn=-9 --runtime=default, --opt=-local,-asmfile,+asm,-speed,+space,-debug --stack=compiled:auto:auto:auto --addrqual=request --mode=pro`。
- **配置字**：从 `.scw` 的 `config=` 行读取（IDE 权威值，含模板外隐藏位规则），写入 `.scx` 头 0xA0 起的 4 个 16 位槽位。
- **芯片参数**：从 IDE 的 `mcu/ini/<chip>.ini` 读取 `ROMSIZE`（程序区大小）、`HEXMCU`（未编程 word 值）。
- **`.scx` 头部**：芯片名 + `!`（烧录器靠 `!` 识别固件，8 字符芯片名如 SC8P052B 不会截断 `!`）。

## 项目结构

```
src/
├── extension.ts         # 扩展入口：命令注册 + 状态栏
├── build.ts             # 编译编排 + 错误诊断解析 + CfgCRC/CfgSum 输出
├── chip.ts              # .scw 解析、芯片列表、cfg 选项模板、配置字计算
├── compiler.ts          # 编译器目录查找（配置/常见路径/盘符/环境变量）
├── scx.ts               # .scx 生成 + 校验值计算
└── webview/
    └── hardwareOptions.ts  # 芯片设置面板（单例）
images/icon.png          # 扩展图标
```

## 开发

```bash
npm install          # 安装依赖
npm run compile      # TypeScript 编译
npm run package      # 打包 .vsix（scmcu-vscode-<version>.vsix）
```

F5 调试：打开本目录，按 F5 启动扩展开发宿主。

## 版本历史

- **v0.8.4** — 脱离 .scw 模式下面板全可用：状态栏「芯片设置」「源文件」两按钮在 scw / scw-less 两种模式都显示；芯片设置面板写 `scmcu.configWords`、源文件面板维护 `scmcu.sourceFiles`（可控制编译顺序）；新增 `SCMCU: 设置芯片型号/设置配置字` 命令面板入口
- **v0.8.3** — 命令面板新增 `SCMCU: 设置芯片型号/设置配置字 (脱离 .scw)`，用输入框直接写工作区设置；`engines.vscode` 从异常的 `^1.134.0` 修正为 `^1.85.0`，避免旧版 VS Code 判为不兼容
- **v0.8.1** — 新增「源文件管理」面板：可视化添加/移除/排序 `.scw` 的 `SourceFile=`
- **v0.7.0** — 插件图标；（之前各版为迭代开发，功能见上文）
- **v0.6.x** — 可配置源码/头文件目录、错误跳转、CfgCRC/CfgSum 与烧录器一致、SC8P 系列 8 字符芯片名修复
- **v0.3.x** — 芯片设置单例窗口、状态栏芯片切换与构建按钮
- **v0.1.x** — 基础编译 + 硬件选项配置 + 编译器自动检测
