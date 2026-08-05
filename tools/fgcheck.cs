using System;
using System.Runtime.InteropServices;
using System.Text;

class FgCheck {
  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  static void Main() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) { Console.WriteLine("NONE"); return; }
    var sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    Console.WriteLine(sb.ToString());
  }
}
