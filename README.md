# SCMCU IDE for VS Code（SC8 系列单片机）

在 VS Code 中编译 SC8F/SC8P 系列单片机工程（基于 SCMCU_IDE 的 MPLAB XC8/PICC 工具链），
支持硬件选项配置、芯片切换、编译器自动检测，并生成 `.scx` 烧录文件。

## 功能

| 命令 | 说明 |
|---|---|
| `SCMCU: 编译` | 编译工程（自动读 .scw 的 Device/源文件顺序/配置字），生成 `.hex` + `.scx` |
| `SCMCU: 硬件选项配置` | 图形化配置 WDT/PROTECT/LVR_SEL/FCPU_DIV 等硬件选项，写回 .scw **并同步写入烧录文件 .scx 的配置字区** |
| `SCMCU: 选择芯片型号` | 从 IDE 芯片库选择型号，更新 .scw 的 Device= |
| `SCMCU: 配置编译器目录` | 手动指定 SCMCU_IDE 安装目录 |
| `SCMCU: 自动检测编译器` | 自动扫描常见安装路径/盘符/环境变量 SCMCU_IDE_HOME |

**状态栏**（底部左侧）：
- `$(chip) SC8F072` —— 显示当前工程芯片型号，**点击直接切换芯片**
- `$(settings-gear) 硬件选项` —— 点击打开硬件选项配置面板

## 使用

1. 用 VS Code 打开包含 `.scw` 工程文件的文件夹（如 `test_sc8f072`）
2. 首次使用执行 `SCMCU: 自动检测编译器`（或手动配置目录）
3. 执行 `SCMCU: 编译` —— 产物在 `build/` 下：
   - `<输出名>.hex`：Intel HEX 程序文件
   - `<输出名>.scx`：烧录文件（含配置字 + 程序，可直接用 IDE 烧录软件打开）
4. 需要改硬件选项（如 LVR 电压、WDT）→ `SCMCU: 硬件选项配置` → 选择 → 保存（写回 .scw，IDE 同步生效）

## 设置项（settings.json）

| 键 | 说明 |
|---|---|
| `scmcu.compilerPath` | SCMCU_IDE 的 `data\bin` 目录（含 picc.exe），留空自动检测 |
| `scmcu.idePath` | SCMCU_IDE 安装根目录（含 `mcu\config`），留空自动检测 |
| `scmcu.buildDir` | 编译输出目录，默认 `build` |
| `scmcu.outputName` | 产物文件名，默认 `SCMCU_Project` |
| `scmcu.sourceDirs` | **C 源文件目录**（相对工程根目录；空串 = 根目录），默认 `["src"]`。`.scw` 的 SourceFile 裸名按此顺序查找 |
| `scmcu.includeDirs` | **头文件 include 目录**（相对工程根目录；空串 = 根目录），默认 `["inc"]`，编译时加入 `-I` |

## 错误跳转（Problem 面板）

编译时 picc 输出的错误/警告会解析到 VS Code「问题」面板（`--errformat` 格式化为机器可读格式），
点击即可跳转到对应源文件行号。编译输出仍保留在「SCMCU」输出面板。

## 工作原理（与 IDE 一致性的保证）

- **源文件顺序**：按 `.scw` 的 `SourceFile=` 行顺序编译——XC8 的 psect 分配依赖编译顺序，顺序不同产物不同（已实测：字母序 vs IDE 顺序差异 504 处）。
- **编译参数**：与 IDE 完全一致（从 IDE 生成的 `startup.as` 头部提取）：`--fill=0xFFFF --output=intel -D__DEBUG=1 -g --asmlist --warn=-9 --runtime=default, --opt=-local,-asmfile,+asm,-speed,+space,-debug --stack=compiled:auto:auto:auto --addrqual=request --mode=pro`。
- **配置字**：从 `.scw` 的 `config=` 行读取（IDE 权威值，含模板外隐藏位规则），写入 `.scx` 头 0xA0 起的 4 个 16 位槽位。
- **芯片参数**：从 IDE 的 `mcu/ini/<chip>.ini` 读取 `ROMSIZE`（程序区大小）、`HEXMCU`（未编程 word 值）。

## 开发

```bash
npm install          # 安装依赖
npm run compile      # TypeScript 编译
npm run package      # 打包 .vsix（在 out 目录，可直接安装）
```

F5 调试：打开本目录，按 F5 启动扩展开发宿主。
