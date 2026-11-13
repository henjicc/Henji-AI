# 画面采集自测用的闪烁色块：在屏幕指定位置开一个不抢焦点的小窗口，黑白交替，记下每次重画完成时的 QPC 时刻。
# selftest.cjs 的 flash 场景用它核对“逐帧时刻表里的系统时刻”与真实上屏时刻差多少。
# 用 Windows 自带的 powershell.exe（5.1）运行；坐标与尺寸是物理像素。
param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$Size = 400,
  [int]$Count = 40,
  [int]$IntervalMs = 300,
  # 每次变色前先把鼠标移到色块里的另一个角，并记下移完的时刻（标定“光标位置进画面”的延迟用）。
  [switch]$Cursor,
  [Parameter(Mandatory = $true)][string]$Out
)

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class FlashForm : Form {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    public static List<long> CursorTicks = new List<long>();

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams parameters = base.CreateParams;
            // 不激活、不进任务栏、置顶：不打断正在用这台机器的人。
            parameters.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008;
            return parameters;
        }
    }

    public static long[] Run(int x, int y, int size, int count, int intervalMs, bool cursor) {
        SetProcessDPIAware();
        FlashForm form = new FlashForm();
        form.FormBorderStyle = FormBorderStyle.None;
        form.StartPosition = FormStartPosition.Manual;
        form.Location = new Point(x, y);
        form.Size = new Size(size, size);
        form.BackColor = Color.Black;
        form.Show();
        form.Refresh();
        Application.DoEvents();
        Thread.Sleep(1000);
        Random random = new Random(7);
        List<long> ticks = new List<long>();
        for (int index = 0; index < count; index++) {
            if (cursor) {
                SetCursorPos(x + (index % 2 == 0 ? size - 60 : 60), y + size - 60);
                CursorTicks.Add(Stopwatch.GetTimestamp());
            }
            form.BackColor = index % 2 == 0 ? Color.White : Color.Black;
            // Refresh 同步重画：返回时新颜色已经画进窗口，合成器下一次合成就会带上。
            form.Refresh();
            ticks.Add(Stopwatch.GetTimestamp());
            Application.DoEvents();
            // 间隔带一点随机量，避免与显示器刷新对齐。
            Thread.Sleep(intervalMs + random.Next(0, 50));
        }
        form.Close();
        return ticks.ToArray();
    }
}
'@

$ticks = [FlashForm]::Run($X, $Y, $Size, $Count, $IntervalMs, $Cursor.IsPresent)
$result = @{ frequency = [System.Diagnostics.Stopwatch]::Frequency; ticks = $ticks; cursorTicks = [FlashForm]::CursorTicks.ToArray() }
[System.IO.File]::WriteAllText($Out, ($result | ConvertTo-Json -Compress))
