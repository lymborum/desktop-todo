using System;
using System.Runtime.InteropServices;
using System.Text;

class PinToDesktop {
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr FindWindow(string cls, string win);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);
  [DllImport("user32.dll")]
  static extern bool SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")]
  static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);

  // 找到桌面图标层所在的 WorkerW（Windows 10/11 桌面壁纸层）
  static IntPtr FindWorkerW() {
    IntPtr progman = FindWindow("Progman", null);
    if (progman == IntPtr.Zero) return IntPtr.Zero;
    IntPtr result;
    SendMessageTimeout(progman, 0x052C, (IntPtr)0xD, (IntPtr)0x1, 0x0002, 1000, out result);
    IntPtr worker = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
        worker = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return worker;
  }

  static void Main(string[] args) {
    if (args.Length < 1) return;
    ulong v;
    if (!ulong.TryParse(args[0], out v)) return;
    IntPtr hwnd = new IntPtr((long)v);
    IntPtr worker = FindWorkerW();
    if (worker == IntPtr.Zero) worker = FindWindow("Progman", null);
    if (worker != IntPtr.Zero) SetParent(hwnd, worker);
  }
}
