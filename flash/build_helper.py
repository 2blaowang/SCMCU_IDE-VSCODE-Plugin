#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重建 ScmcuFlashHelper.exe（net40 / x86，引用 Writer.Core.dll）。

用法:
  python flash/build_helper.py                 # 下载 Roslyn(如缺) + 编译
  python flash/build_helper.py --skip-download # 仅编译（用已缓存编译器）

原理:
  * 本机/目标机构建机无需 .NET SDK：从 NuGet 拉 Microsoft.Net.Compilers.Toolset 4.8.x
    （其 csc 目标 net8.0，跑在 .NET 8+ runtime 上），手动引用 .NET Framework 4.x
    运行库（C:/Windows/Microsoft.NET/Framework/v4.0.30319，x86）编译 net40 目标。
  * Writer.Core.dll 引用自 <WRITER_LIB> 默认 F:/Work/SCMCU_Writer_V9.01.16/library，
    可用 --writer-lib 覆盖；该 dll 仅编译期需要，运行期由 helper 的 AssemblyResolve
    从目标 Writer 安装目录加载。
"""
import subprocess, os, sys, json, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 插件根
SRC = os.path.join(ROOT, 'flash', 'ScmcuFlashHelper.cs')
OUT = os.path.join(ROOT, 'flash', 'ScmcuFlashHelper.exe')
CACHE = r'C:/Users/Administrator/.workbuddy/binaries/roslyn'

def dec(b):
    if not b:
        return ''
    for enc in ('gbk', 'utf-8'):
        try:
            return b.decode(enc)
        except Exception:
            pass
    return b.decode('utf-8', errors='replace')

def find_csc():
    for root, _dirs, files in os.walk(CACHE):
        for f in files:
            if f.lower() == 'csc.dll' and 'netcore' in root.lower().replace('\\', '/'):
                return os.path.join(root, f)
    return None

def download_toolset():
    base = 'https://api.nuget.org/v3-flatcontainer/'
    idx = json.loads(urllib.request.urlopen(base + 'microsoft.net.compilers.toolset/index.json', timeout=60).read())
    vers = [v for v in idx['versions'] if v.startswith('4.8')]
    ver = vers[-1] if vers else idx['versions'][-1]
    print('Roslyn toolset:', ver)
    os.makedirs(CACHE, exist_ok=True)
    nupkg = os.path.join(CACHE, 'toolset.nupkg')
    if not os.path.exists(nupkg):
        url = f'{base}microsoft.net.compilers.toolset/{ver}/microsoft.net.compilers.toolset.{ver}.nupkg'
        print('download', url)
        data = urllib.request.urlopen(url, timeout=120).read()
        open(nupkg, 'wb').write(data)
    with zipfile.ZipFile(nupkg) as z:
        z.extractall(CACHE)
    csc = find_csc()
    if not csc:
        raise SystemExit('FAIL: 未在缓存中找到 csc.dll')
    print('csc:', csc)

def main():
    skip_dl = '--skip-download' in sys.argv
    if not skip_dl:
        download_toolset()
    csc = find_csc()
    if not csc:
        raise SystemExit('FAIL: Roslyn 缓存缺失，先不带 --skip-download 运行')

    fw = r'C:/Windows/Microsoft.NET/Framework/v4.0.30319'  # x86
    writer_lib = r'F:/Work/SCMCU_Writer_V9.01.16/library'
    for i, a in enumerate(sys.argv):
        if a == '--writer-lib' and i + 1 < len(sys.argv):
            writer_lib = sys.argv[i + 1]

    fw_refs = ['mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Xml.dll',
               'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Configuration.dll']
    lib_refs = ['Writer.Core.dll', 'Mono.Cecil.dll', 'WinFormsUIDocking.dll',
                'Forms.HexBox.dll', 'RadioButtonList.dll']
    args = ['dotnet', csc, '/nologo', '/noconfig', '/nostdlib+',
            '/target:exe', '/platform:x86', '/optimize+', '/debug-', '/out:' + OUT]
    for r in fw_refs:
        args.append('/r:' + os.path.join(fw, r))
    for r in lib_refs:
        p = os.path.join(writer_lib, r)
        if os.path.exists(p):
            args.append('/r:' + p)
        else:
            print('WARN 缺引用(可忽略):', p)
    args.append(SRC)
    r = subprocess.run(args, capture_output=True)
    print('=== rc:', r.returncode)
    out_t, err_t = dec(r.stdout), dec(r.stderr)
    if out_t.strip():
        print('--- stdout ---'); print(out_t[-3000:])
    if err_t.strip():
        print('--- stderr ---'); print(err_t[-3000:])
    if r.returncode == 0 and os.path.exists(OUT):
        import struct
        with open(OUT, 'rb') as f:
            head = f.read(0x400)
        pe = struct.unpack_from('<I', head, 0x3C)[0]
        mach = struct.unpack_from('<H', head, pe + 4)[0]
        print(f'OK: {OUT}  {os.path.getsize(OUT)} B  PE machine 0x{mach:04X} '
              f'({"x86" if mach == 0x14c else "x64"})')
    else:
        raise SystemExit('COMPILE FAILED')

if __name__ == '__main__':
    main()
