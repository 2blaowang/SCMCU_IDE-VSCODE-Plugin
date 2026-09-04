// ScmcuFlashHelper.cs — SCMCU Writer 烧录命令行助手（net40 / x86，引用 Writer.Core.dll）
//
// 背景：SCMCU Writer（烧录器上位机）是 WinForms GUI（Program.cs 无命令行参数），无法静默驱动。
// 本 helper 复用其 Writer.Core.dll（含加密 SQLite 芯片库访问 + 固件数据解析 + USB HID 烧录协议），
// 以命令行方式完成「连接编程器 → 解析 .scx 固件 → 0x61/0x21 信息帧 → 分段下载 ROM/Config/EE/BootROM
// → 0x60 校验 → 0x50 结束」全流程，供 VS Code 插件一键编译下载调用。
//
// 关键点：
//   * 程序集依赖（Writer.Core/SqlciperDll 等）通过 AssemblyResolve 从 --writer/library 目录解析，
//     本 exe 可放在任意位置，不污染 Writer 安装目录。
//   * SqlciperDll.dll 为 x86 原生库 → 本程序必须以 x86 编译（PlatformTarget=x86）。
//   * 运行目录必须是 Writer 安装目录（cwd），其下 data/ 含 system.info / database.db / upgrade/。
//   * 纯逻辑驱动（绕开 GUI 的 FrmOutput/DelegateCollection/MessageBox/wafer 步），
//     帧序列与 Run.StartDownload() 等价，仅跳过「版本一致性 gate」与「座测(wafer)数据下发」。
//   * Main 不直接引用 cms_writer 类型（避免 JIT 时机早于 AssemblyResolve 注册），
//     业务全部在 RunCore() 中，由 Main 注册解析器后调用。
//
// 用法：
//   ScmcuFlashHelper.exe --writer <Writer安装目录> --scx <固件.scx>
//        [--vid 1209] [--pid 0201] [--mcu SC8F052] [--count 1] [--annotation 注解] [--probe]
// 输出：stdout UTF-8 分步状态行（[STEP] / [OK] / [ERROR]），退出码 0=成功。
//
using System;
using System.IO;
using System.Reflection;
using System.Text;

namespace ScmcuFlash
{
    internal static class Program
    {
        private static string _writerDir = "";

        private sealed class Opts
        {
            public int Vid = 0x1209;
            public int Pid = 0x0201;
            public int Count = 1;
            public string Scx = "";
            public string Mcu = "";
            public string Annotation = "";
            public bool Probe;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Opts o = new Opts();
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--writer": if (i + 1 < args.Length) _writerDir = args[++i]; break;
                    case "--scx": if (i + 1 < args.Length) o.Scx = args[++i]; break;
                    case "--mcu": if (i + 1 < args.Length) o.Mcu = args[++i]; break;
                    case "--vid": if (i + 1 < args.Length) o.Vid = ParseHex(args[++i], o.Vid); break;
                    case "--pid": if (i + 1 < args.Length) o.Pid = ParseHex(args[++i], o.Pid); break;
                    case "--count": if (i + 1 < args.Length) int.TryParse(args[++i], out o.Count); break;
                    case "--annotation": if (i + 1 < args.Length) o.Annotation = args[++i]; break;
                    case "--probe": o.Probe = true; break;
                }
            }

            if (string.IsNullOrEmpty(_writerDir) || string.IsNullOrEmpty(o.Scx) || !File.Exists(o.Scx))
            {
                Console.Error.WriteLine("[ERROR] 用法: ScmcuFlashHelper.exe --writer <Writer目录> --scx <固件.scx> [--pid 0201] [--mcu SC8F052]");
                return 2;
            }
            try { _writerDir = Path.GetFullPath(_writerDir); } catch { }

            // 注册依赖解析必须在引用任何 cms_writer 类型之前（Main 本身不引用，安全）
            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;

            try
            {
                return RunCore(o);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[ERROR] 异常: " + ex);
                return 1;
            }
        }

        private static int RunCore(Opts o)
        {
            // 此处才引用 cms_writer 类型（JIT 时 AssemblyResolve 已注册）
            string library = Path.Combine(_writerDir, "library");
            if (!File.Exists(Path.Combine(library, "Writer.Core.dll")))
            {
                Console.Error.WriteLine("[ERROR] 未找到 Writer 程序集: " + Path.Combine(library, "Writer.Core.dll"));
                return 2;
            }
            if (!File.Exists(Path.Combine(_writerDir, "data", "system.info")) ||
                !File.Exists(Path.Combine(_writerDir, "data", "database.db")))
            {
                Console.Error.WriteLine("[ERROR] Writer 安装目录缺少 data/system.info 或 data/database.db，请确认 --writer 指向 SCMCU Writer 安装目录");
                return 2;
            }

            Environment.CurrentDirectory = _writerDir; // 所有 .\data\ 相对访问

            // ---- 1) 系统信息：填充数据库表名（system.info 为 XOR 17 加密 XML）----
            cms_writer.Global.ReadSystemInfoFile();
            if (cms_writer.Global.McuDbTableNames.Count == 0)
            {
                Console.Error.WriteLine("[ERROR] data/system.info 解析失败（未取到芯片数据库表名）");
                return 2;
            }

            // ---- 2) 打开加密芯片库（database.db, SqlciperDll）+ 配置模板库（config.xml）----
            cms_writer.Global.GetDatabaseVersion();
            Console.WriteLine("[STEP] 芯片数据库: " + cms_writer.Global.DatabaseVer);
            // GUI 启动序列在进入主界面后调用 ReadXml(".\\data\\config.xml")，加载 MCU 配置模板
            // （NameInfoList/McuConfigList/BaseInfoList/MaskDatasList），GetMcuBaseInfo 依赖它。
            string cfgXml = Path.Combine(_writerDir, "data", "config.xml");
            if (File.Exists(cfgXml))
            {
                cms_writer.XMLDataProcessor.Instance.ReadXml(cfgXml);
                Console.WriteLine("[STEP] 配置模板库: " + Path.GetFileName(cfgXml) + " (" +
                    cms_writer.XMLDataProcessor.Instance.NameInfoList.Count + " 系列)");
            }
            else
            {
                Console.Error.WriteLine("[WARN] data/config.xml 不存在，芯片配置模板将缺失");
            }

            // ---- 3) USB 连接编程器 ----
            cms_writer.Usb usb = new cms_writer.Usb(o.Vid, o.Pid);
            if (!usb.CheckDeviceConnect())
            {
                Console.Error.WriteLine(string.Format("[ERROR] 未检测到编程器 (VID 0x{0:X4} PID 0x{1:X4})。请确认 USB 连接、编程器处于正常(非升级)模式。", o.Vid, o.Pid));
                return 3;
            }
            usb.StartUsb();
            Console.WriteLine(string.Format("[STEP] 已连接编程器 VID 0x{0:X4} PID 0x{1:X4}", o.Vid, o.Pid));

            // 按 PID 确定机型（决定芯片库过滤与 McuNameList；GUI 在 StartUpBuffer 选机后执行）
            CMS.Writer.WaferBinData.WriterType wt;
            if (o.Pid == 0x0101 || o.Pid == 0x0201) wt = CMS.Writer.WaferBinData.WriterType.CMS_WRITER_LITE;
            else if (o.Pid == 0x0011 || o.Pid == 0x0032) wt = CMS.Writer.WaferBinData.WriterType.CMS_WRITERV8;
            else if (o.Pid == 0x0021 || o.Pid == 0x0023) wt = CMS.Writer.WaferBinData.WriterType.CMS_WRITERV8_PRO;
            else if (o.Pid == 0x1102 || o.Pid == 0x1502) wt = CMS.Writer.WaferBinData.WriterType.CMS_ICE8_PRO;
            else wt = cms_writer.Global.TarWriterType; // 保持默认
            if (cms_writer.Global.TarWriterType != wt) cms_writer.Global.TarWriterType = wt;
            cms_writer.Global.GetMcuNameList();
            Console.WriteLine("[STEP] 机型: " + cms_writer.Global.TarWriterType + "  库支持型号: " + cms_writer.Global.McuNameList.Count);

            cms_writer.SendCmd sc = new cms_writer.SendCmd(usb);
            byte[] ver = sc.ReadVersionDataCmd();
            if (ver != null && ver.Length > 26)
            {
                Console.WriteLine(string.Format("[INFO] 编程器 WriterID={0}  AppVer={1}  BootVer={2}  HW=0x{3:X8}",
                    (ver[5] << 24) + (ver[4] << 16) + (ver[3] << 8) + ver[2],
                    FormatVersion(ver, 22), FormatVersion(ver, 18),
                    (uint)((ver[29] << 24) + (ver[28] << 16) + (ver[27] << 8) + ver[26])));
            }
            else
            {
                Console.WriteLine("[WARN] 读取编程器版本失败（继续尝试下载）");
            }

            // ---- 4) 芯片库初始化 + .scx 固件解析 ----
            string chipName = ReadScxChipName(o.Scx);
            if (string.IsNullOrEmpty(chipName))
            {
                Console.Error.WriteLine("[ERROR] 无法从 .scx 头部读取芯片名（文件损坏？）");
                return 4;
            }
            if (!string.IsNullOrEmpty(o.Mcu) && !string.Equals(o.Mcu, chipName, StringComparison.OrdinalIgnoreCase))
            {
                Console.WriteLine("[WARN] 参数 --mcu " + o.Mcu + " 与 .scx 内芯片名 " + chipName + " 不一致，以 .scx 为准");
            }
            Console.WriteLine("[STEP] 芯片: " + chipName);

            bool changed = false;
            if (!cms_writer.Global.SetMcu(cms_writer.Global.mcu, chipName, ref changed))
            {
                Console.Error.WriteLine("[ERROR] 芯片库中未找到型号 " + chipName + "（当前 Writer 的数据库或机型不支持？）");
                return 4;
            }

            cms_writer.CmxFileDataProcessor proc = new cms_writer.CmxFileDataProcessor(o.Scx);
            if (!proc.ReadDatas())
            {
                Console.Error.WriteLine("[ERROR] 固件文件解析失败（版本不支持或文件损坏）");
                return 4;
            }
            Console.WriteLine(string.Format("[STEP] 固件: ROM {0} B, Config {1} B, EE {2} B, BootROM {3} B",
                cms_writer.Global.mcu.RomDatas.Count,
                cms_writer.Global.mcu.CfgDataProcessor.GetConfigByteLength(),
                cms_writer.Global.mcu.EeDatas.Count,
                cms_writer.Global.mcu.BootRomDatas.Count));

            // ---- 5) CRC16 汇总 + 下载参数 ----
            cms_writer.Global.GetAllCRC();
            if (o.Count < 1) o.Count = 1;
            if (o.Count > 0xFFFF) o.Count = 0xFFFF;
            cms_writer.Global.WriterCount = (uint)o.Count;
            cms_writer.Global.ImageAnnotation = o.Annotation;
            Console.WriteLine("[STEP] 下载参数: 片数=" + o.Count + (o.Annotation.Length > 0 ? " 注解=" + o.Annotation : ""));

            // ---- probe：只做链路验证，不发任何写命令（不烧录）----
            if (o.Probe)
            {
                Console.WriteLine("[OK] probe 通过：设备连接/芯片库/固件解析均正常。未执行烧录。");
                try { usb.Destroy(); } catch { }
                return 0;
            }

            // ---- 6) 下载时序（等价 Run.StartDownload，跳过 wafer/版本 gate/UI）----
            if (sc.SendMcutypeOfflineInfo1() != cms_writer.E_ERROR_TYPE.NO_ERROR) return Fail(sc, usb, "0x61 信息帧1 被拒绝");
            Console.WriteLine("[STEP] 0x61 信息帧1 OK (Series=" + cms_writer.Global.mcu.Series + " Type=" + cms_writer.Global.mcu.Type + ")");

            if (sc.SendImageInfo2Cmd(cms_writer.Global.mcu.Name, cms_writer.Global.ImageAnnotation) != cms_writer.E_ERROR_TYPE.NO_ERROR) return Fail(sc, usb, "0x21 信息帧2 被拒绝");
            Console.WriteLine("[STEP] 0x21 信息帧2 OK");

            if (!sc.SendDataCmd(cms_writer.UsbCommandType.CMD_DOWNLOAD_DATA, cms_writer.Global.mcu.RomDatas)) return Fail(sc, usb, "ROM 数据下载失败");
            Console.WriteLine("[STEP] ROM 数据段 OK (" + cms_writer.Global.mcu.RomDatas.Count + " B)");

            if (!sc.SendDataCmd(cms_writer.UsbCommandType.CMD_DOWNLOAD_CONFIG, cms_writer.Global.mcu.CfgDataProcessor.GetConfigByteDatas())) return Fail(sc, usb, "Config 数据下载失败");
            Console.WriteLine("[STEP] Config 数据段 OK");

            if (cms_writer.Global.mcu.EepromSize > 0 &&
                !sc.SendDataCmd(cms_writer.UsbCommandType.CMD_DOWNLOAD_EEDATA, cms_writer.Global.mcu.EeDatas)) return Fail(sc, usb, "EE 数据下载失败");
            if (cms_writer.Global.mcu.EepromSize > 0) Console.WriteLine("[STEP] EE 数据段 OK");

            if (cms_writer.Global.mcu.BootRomDatas.Count > 0 &&
                !sc.SendDataCmd(cms_writer.UsbCommandType.CMD_DOWNLOAD_BOOTROM, cms_writer.Global.mcu.BootRomDatas)) return Fail(sc, usb, "BootROM 下载失败");
            if (cms_writer.Global.mcu.BootRomDatas.Count > 0) Console.WriteLine("[STEP] BootROM 数据段 OK");

            if (sc.SendVerifyDownload() != cms_writer.E_ERROR_TYPE.NO_ERROR) return Fail(sc, usb, "0x60 校验失败（芯片可能未放好或为空白片）");
            Console.WriteLine("[STEP] 0x60 整段校验 OK");

            sc.SendStopDeviceCmd(cms_writer.E_STOP_DEVICE_MODE.ALL_OK_MODE);
            usb.Destroy();
            Console.WriteLine("[OK] 下载完成！");
            return 0;
        }

        private static int Fail(cms_writer.SendCmd sc, cms_writer.Usb usb, string msg)
        {
            try { sc.SendStopDeviceCmd(cms_writer.E_STOP_DEVICE_MODE.ALL_FAIL_MODE); } catch { }
            try { usb.Destroy(); } catch { }
            Console.Error.WriteLine("[ERROR] " + msg);
            return 5;
        }

        // 深度诊断：逐步复现 GetMcuBaseInfo 失败点

        // 诊断：枚举芯片库中指定前缀的实际型号名
        private static void DumpMcuNames(string like)
        {
            try
            {
                cms_writer.SQLiteHelper db = cms_writer.SQLiteHelper.Instance;
                Console.WriteLine("[DBG] 数据库表: " + string.Join(", ", cms_writer.Global.McuDbTableNames.ToArray()));
                foreach (string t in cms_writer.Global.McuDbTableNames)
                {
                    string sql = "SELECT DISTINCT m.MCU_NAME FROM " + t + " AS m INNER JOIN TABLE_SERIES AS s WHERE m.MCU_SERIES = s.ID AND m.MCU_NAME LIKE '" + like + "%'";
                    if (db.SQLiteExe(sql) && db.QueryResult.Count > 0 && db.QueryResult[0] != null && db.QueryResult[0].Count > 0)
                    {
                        string[] names = db.QueryResult[0].ToArray();
                        Console.WriteLine("[DBG] 表 " + t + " 中 " + like + "* 型号(" + names.Length + "): " + string.Join(", ", names));
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("[DBG] 型号枚举失败: " + ex.Message);
            }
        }



        // 依赖解析：Writer.Core 及其引用（Mono.Cecil/WinFormsUIDocking/Forms.HexBox/RadioButtonList）
        // 一律从 --writer/library 目录加载。
        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            string[] candidates = { name, name + ".dll" };
            foreach (string c in candidates)
            {
                string p = Path.Combine(_writerDir, "library", c);
                if (File.Exists(p)) return Assembly.LoadFrom(p);
            }
            return null;
        }

        // .scx 头 0..159 为 ASCII 芯片名，遇 0x21('!') 结束
        private static string ReadScxChipName(string scxPath)
        {
            try
            {
                byte[] head = new byte[160];
                using (FileStream fs = File.OpenRead(scxPath))
                {
                    int n = fs.Read(head, 0, 160);
                    if (n < 4) return "";
                }
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < head.Length; i++)
                {
                    if (head[i] == 0x21 || head[i] == 0) break; // '!' 或 NUL
                    sb.Append((char)head[i]);
                }
                return sb.ToString();
            }
            catch { return ""; }
        }

        private static int ParseHex(string s, int def)
        {
            if (s.StartsWith("0x") || s.StartsWith("0X")) s = s.Substring(2);
            int v;
            return int.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out v) ? v : def;
        }

        // 版本号编码：word = b1*256+b0；y = w/31/12, m = w/31%12, d = w%31（31 溢出回绕处理见 Writer）
        private static string FormatVersion(byte[] code, int start)
        {
            try
            {
                if (code.Length < start + 4) return "?";
                int num = code[start + 1] * 256 + code[start];
                uint w = (uint)num % 31u;
                uint m = ((uint)num / 31u) % 12u;
                uint y = (uint)num / 31u / 12u;
                if (w == 0) { if (m == 0) { w = 31; m = 11; if (y > 0) y--; } else { w = 31; m--; } }
                return string.Format("{0}.{1:D2}.{2:D2}", y, m + 1, w);
            }
            catch { return "?"; }
        }
    }
}
