# SCMCU IDE for VS Code（SC8 系列单片机）

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.7.0-orange.svg)](https://github.com/2blaowang/SCMCU_IDE-VSCODE-Plugin/releases)

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
算法是从烧录器核心库 `SCMCU_Writer\library\Writer.Core.dll`（.NET）反编译提取的：

```
CfgSum = (Σ 程序区字节 + Σ 配置字区字节) & 0xFFFF
         配置字每个 16 位字计: 低字节 + 高字节（CMS 内核）

CfgCRC = 链式 CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, xorout=0)
         ① 先对程序区字节做 CRC → 得 CodeCrc16
         ② 再以 CodeCrc16 为初值继续对配置字区字节做 CRC

配置字数 = .scx 0xA0 偏移起"连续非 0xFFFF"的槽位数（补齐位不计）
```

实测样本（与烧录器显示逐位一致）：

| 工程 | 芯片 | 配置字 | CfgSum | CfgCRC |
|---|---|---|---|---|
| test | SC8F052 | 7FFF,FFEF | AA75 | 9665 |

## 设置项（settings.json）

| 键 | 说明 |
|---|---|
| `scmcu.compilerPath` | SCMCU_IDE 的 `data\bin` 目录（含 picc.exe），留空自动检测 |
| `scmcu.idePath` | SCMCU_IDE 安装根目录（含 `mcu\config`），留空自动检测 |
| `scmcu.buildDir` | 编译输出目录，默认 `build` |
| `scmcu.outputName` | 产物文件名，默认 `SCMCU_Project` |
| `scmcu.sourceDirs` | **C 源文件目录**（相对工程根目录；空串 = 根目录），默认 `["src"]` |
| `scmcu.includeDirs` | **头文件 include 目录**（相对工程根目录；空串 = 根目录），默认 `["inc"]`，编译时加入 `-I` |

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

- **v0.7.0** — 插件图标；（之前各版为迭代开发，功能见上文）
- **v0.6.x** — 可配置源码/头文件目录、错误跳转、CfgCRC/CfgSum 与烧录器一致、SC8P 系列 8 字符芯片名修复
- **v0.3.x** — 芯片设置单例窗口、状态栏芯片切换与构建按钮
- **v0.1.x** — 基础编译 + 硬件选项配置 + 编译器自动检测
