# test/fixtures — 配置字回归测试夹具

本目录模拟 SCMCU_IDE 安装目录的芯片数据布局，供 `test/configWords.regression.js` 使用，
**不需要本机安装 SCMCU_IDE**，clone 后 `npm run compile && npm test` 即可复跑。

## 目录布局

```
fixtures/ide/mcu/config/SC8F052.cfg   ← 芯片选项模板（定义各硬件选项覆盖的位）
fixtures/ide/mcu/config/SC8F072.cfg
fixtures/ide/mcu/ini/SC8F052.ini      ← 芯片参数（HEXMCU=3FFF, 14-bit）
fixtures/ide/mcu/ini/SC8F072.ini      ← 芯片参数（HEXMCU=FFFF, 16-bit）
```

## 来源

- 拷自 SCMCU_IDE_V2.00.16_Beta13 的 `mcu/config` 与 `mcu/ini`（原始文件字节级复制）。
- 仅含回归测试用到的两个芯片；如需扩展，照此布局补充对应 `.cfg` / `.ini` 即可。

## 更新注意

- `.cfg` 决定"模板定义位"，直接影响 `normalizeConfigWordsCore` 的输出期望值；
  若更新夹具，请同步更新 `configWords.regression.js` 中的期望断言。
- 带后缀型号（如 SC8F052A04）故意不放 `.ini`，用于验证缺失时按型号兜底的分支。
