using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace EsfUpdateFix
{
    static class Program
    {
        static Form form;
        static Label status;
        static ProgressBar bar;
        static TextBox detail;
        static Button closeBtn;

        static string installerArg = "";
        static string dirArg = "";
        static bool noLaunch = false;
        static bool noClose = false;
        static string logPath = Path.Combine(Path.GetTempPath(), "esf-update-fix.log");

        const string FEED = "https://119.29.82.217/updates/";
        const string LAUNCHER_EXE = "ESF 平台.exe";

        [STAThread]
        static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "-Installer" && i + 1 < args.Length) installerArg = args[++i];
                else if (args[i] == "-Dir" && i + 1 < args.Length) dirArg = args[++i];
                else if (args[i] == "-NoLaunch") noLaunch = true;
                else if (args[i] == "-NoClose") noClose = true;
            }

            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };

            Application.EnableVisualStyles();
            form = new Form();
            form.Text = "ESF 平台 · 更新修复";
            form.ClientSize = new Size(460, 210);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.MaximizeBox = false;
            form.BackColor = Color.FromArgb(16, 18, 24);
            form.ForeColor = Color.White;

            status = new Label();
            status.Text = "正在准备…";
            status.SetBounds(20, 18, 420, 40);
            status.ForeColor = Color.White;
            status.Font = new Font("Microsoft YaHei UI", 10f);
            form.Controls.Add(status);

            bar = new ProgressBar();
            bar.SetBounds(20, 66, 420, 12);
            bar.Style = ProgressBarStyle.Marquee;
            form.Controls.Add(bar);

            detail = new TextBox();
            detail.Multiline = true;
            detail.ReadOnly = true;
            detail.ScrollBars = ScrollBars.Vertical;
            detail.SetBounds(20, 90, 420, 66);
            detail.BackColor = Color.FromArgb(24, 26, 34);
            detail.ForeColor = Color.FromArgb(190, 196, 210);
            detail.BorderStyle = BorderStyle.FixedSingle;
            detail.Font = new Font("Microsoft YaHei UI", 8.5f);
            form.Controls.Add(detail);

            closeBtn = new Button();
            closeBtn.Text = "关闭";
            closeBtn.SetBounds(354, 166, 86, 28);
            closeBtn.Enabled = false;
            closeBtn.Click += delegate { form.Close(); };
            form.Controls.Add(closeBtn);

            form.Shown += delegate { ThreadPool.QueueUserWorkItem(delegate { Run(); }); };
            Application.Run(form);
        }

        static void Log(string msg)
        {
            string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg;
            try { File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8); } catch { }
            if (form != null && !form.IsDisposed)
            {
                form.BeginInvoke((Action)delegate
                {
                    if (detail.TextLength > 0) detail.AppendText(Environment.NewLine);
                    detail.AppendText(msg);
                });
            }
        }

        static void SetStatus(string msg)
        {
            if (form != null && !form.IsDisposed)
                form.BeginInvoke((Action)delegate { status.Text = msg; });
        }

        static void SetBar(int percent)
        {
            if (form != null && !form.IsDisposed)
                form.BeginInvoke((Action)delegate
                {
                    if (percent < 0) { bar.Style = ProgressBarStyle.Marquee; }
                    else { bar.Style = ProgressBarStyle.Continuous; bar.Value = Math.Min(100, Math.Max(0, percent)); }
                });
        }

        static void Finish(bool ok, string message, string launchPath)
        {
            Log(message);
            SetBar(ok ? 100 : 0);
            SetStatus(ok ? "更新完成" : "更新没有完成");
            if (ok && !noLaunch && !string.IsNullOrEmpty(launchPath) && File.Exists(launchPath))
            {
                try { Process.Start(new ProcessStartInfo(launchPath) { WorkingDirectory = Path.GetDirectoryName(launchPath), UseShellExecute = true }); Log("已重新启动平台"); }
                catch (Exception ex) { Log("重启平台失败：" + ex.Message); }
            }
            if (form != null && !form.IsDisposed)
                form.BeginInvoke((Action)delegate { closeBtn.Enabled = true; if (!ok) MessageBox.Show(form, message, "ESF 平台 · 更新修复", MessageBoxButtons.OK, MessageBoxIcon.Warning); });
        }

        static void Run()
        {
            try
            {
                Log("开始：ESF 平台更新修复");
                string dir = ResolveLauncherDir();
                if (dir == null) { Finish(false, "没找到已安装的 ESF 平台。请把本程序放到平台文件夹里再运行一次。", null); return; }
                Log("平台目录：" + dir);
                string launcher = Path.Combine(dir, LAUNCHER_EXE);
                if (!File.Exists(launcher))
                {
                    var alt = Directory.GetFiles(dir, "*.exe").FirstOrDefault(f => Path.GetFileName(f).IndexOf("ESF", StringComparison.OrdinalIgnoreCase) >= 0);
                    if (alt != null) launcher = alt;
                }

                string latestVersion = FetchLatestVersion();
                string installer = installerArg;
                if (string.IsNullOrEmpty(installer)) installer = FindPendingInstaller(latestVersion);
                if (installer != null) Log("使用已下载的安装包：" + Path.GetFileName(installer));
                else
                {
                    installer = DownloadLatest(latestVersion);
                    Log("安装包下载完成：" + Path.GetFileName(installer));
                }

                if (!noClose) CloseLauncher();
                SetStatus("正在安装新版本，请不要关闭…");
                Log("开始安装：" + Path.GetFileName(installer));

                var psi = new ProcessStartInfo();
                psi.FileName = installer;
                psi.Arguments = "/S /D=" + dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                var p = Process.Start(psi);
                if (p == null) { Finish(false, "安装包没有启动起来。", null); return; }
                p.WaitForExit();
                Log("安装包退出码：" + p.ExitCode);

                if (!File.Exists(launcher)) { Finish(false, "安装完成后没有找到平台主程序，请手动下载安装包。", null); return; }
                var ver = FileVersionInfo.GetVersionInfo(launcher).FileVersion;
                Finish(true, "已更新到 " + (ver ?? "新版本") + "：" + dir, launcher);
            }
            catch (Exception ex)
            {
                Finish(false, "更新失败：" + ex.Message, null);
            }
        }

        static string ResolveLauncherDir()
        {
            if (!string.IsNullOrEmpty(dirArg)) return dirArg;
            int selfId = Process.GetCurrentProcess().Id;
            try
            {
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id == selfId) continue;
                        if (p.MainModule == null) continue;
                        var dir = Path.GetDirectoryName(p.MainModule.FileName);
                        if (File.Exists(Path.Combine(dir, LAUNCHER_EXE))) return dir;
                    }
                    catch { }
                }
            }
            catch { }

            try
            {
                var hives = new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine };
                var paths = new[] { "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" };
                foreach (var hive in hives)
                foreach (var path in paths)
                {
                    using (var k = hive.OpenSubKey(path))
                    {
                        if (k == null) continue;
                        foreach (var name in k.GetSubKeyNames())
                        {
                            using (var sub = k.OpenSubKey(name))
                            {
                                if (sub == null) continue;
                                var display = sub.GetValue("DisplayName") as string;
                                if (string.IsNullOrEmpty(display) || display.IndexOf("ESF", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                var loc = sub.GetValue("InstallLocation") as string;
                                if (!string.IsNullOrEmpty(loc) && Directory.Exists(loc) && File.Exists(Path.Combine(loc, LAUNCHER_EXE))) return loc;
                                var icon = sub.GetValue("DisplayIcon") as string;
                                if (!string.IsNullOrEmpty(icon))
                                {
                                    var exePath = icon.Trim('"').Split(',')[0].Trim('"');
                                    if (File.Exists(exePath)) return Path.GetDirectoryName(exePath);
                                }
                            }
                        }
                    }
                }
            }
            catch { }

            var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "esf-launcher");
            if (File.Exists(Path.Combine(local, LAUNCHER_EXE))) return local;

            var probes = new List<string>();
            probes.Add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
            probes.Add(Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)));
            try { probes.AddRange(Directory.GetLogicalDrives().Select(d => d)); } catch { }

            foreach (var probe in probes)
            {
                try
                {
                    if (!Directory.Exists(probe)) continue;
                    var hit = FindLauncherUnder(probe, 0);
                    if (hit != null) return hit;
                }
                catch { }
            }
            return null;
        }

        static string FindLauncherUnder(string dir, int depth)
        {
            if (depth > 3) return null;
            try
            {
                if (File.Exists(Path.Combine(dir, LAUNCHER_EXE))) return dir;
                foreach (var sub in Directory.GetDirectories(dir))
                {
                    var name = Path.GetFileName(sub);
                    if (name.StartsWith("$") || name.Equals("Windows", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("Program Files", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("Program Files (x86)", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("System Volume Information", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("AppData", StringComparison.OrdinalIgnoreCase)) continue;
                    var hit = FindLauncherUnder(sub, depth + 1);
                    if (hit != null) return hit;
                }
            }
            catch { }
            return null;
        }

        static string FetchLatestVersion()
        {
            try
            {
                using (var wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "ESF-UpdateFix/1.0");
                    var yml = wc.DownloadString(FEED + "latest.yml?ts=" + DateTime.Now.Ticks);
                    var m = Regex.Match(yml, @"version:\s*([0-9]+(?:\.[0-9]+)+)");
                    if (m.Success) { Log("线上最新版本：" + m.Groups[1].Value); return m.Groups[1].Value; }
                }
            }
            catch (Exception ex) { Log("读取版本信息失败：" + ex.Message); }
            return null;
        }

        static string FindPendingInstaller(string latestVersion)
        {
            try
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "esf-launcher-updater", "pending");
                if (!Directory.Exists(dir)) return null;
                string best = null; Version bestVer = null;
                foreach (var f in Directory.GetFiles(dir, "ESF-Platform-Setup-*.exe"))
                {
                    var m = Regex.Match(Path.GetFileName(f), @"Setup-([0-9]+(?:\.[0-9]+)+)\.exe$");
                    if (!m.Success) continue;
                    Version v;
                    if (!Version.TryParse(DotNetVersion(m.Groups[1].Value), out v)) continue;
                    if (latestVersion != null)
                    {
                        Version lv;
                        if (Version.TryParse(DotNetVersion(latestVersion), out lv) && v < lv) continue;
                    }
                    if (bestVer == null || v > bestVer) { bestVer = v; best = f; }
                }
                return best;
            }
            catch { return null; }
        }

        static string DotNetVersion(string v)
        {
            var parts = v.Split('.');
            while (parts.Length < 3) v += ".0";
            return v;
        }

        static string DownloadLatest(string latestVersion)
        {
            if (latestVersion == null) throw new Exception("无法连接更新服务器，请检查网络后重试");
            string name = "ESF-Platform-Setup-" + latestVersion + ".exe";
            string dest = Path.Combine(Path.GetTempPath(), name);
            if (File.Exists(dest) && new FileInfo(dest).Length > 100 * 1024 * 1024) { Log("临时目录已有安装包，直接使用"); return dest; }

            SetStatus("正在下载安装包 " + latestVersion + "…");
            SetBar(0);
            var req = (HttpWebRequest)WebRequest.Create(FEED + name);
            req.UserAgent = "ESF-UpdateFix/1.0";
            req.Timeout = 30000;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var input = resp.GetResponseStream())
            using (var output = File.Create(dest))
            {
                long total = resp.ContentLength;
                long read = 0;
                var buffer = new byte[81920];
                int n;
                int lastPercent = -5;
                while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    output.Write(buffer, 0, n);
                    read += n;
                    if (total > 0)
                    {
                        int percent = (int)(read * 100 / total);
                        if (percent >= lastPercent + 5) { lastPercent = percent; SetBar(percent); SetStatus("正在下载安装包 " + latestVersion + "… " + percent + "%"); }
                    }
                }
            }
            return dest;
        }

        static void CloseLauncher()
        {
            int selfId = Process.GetCurrentProcess().Id;
            var procs = Process.GetProcesses().Where(p =>
            {
                try { return p.Id != selfId && p.ProcessName == "ESF 平台"; }
                catch { return false; }
            }).ToList();
            if (procs.Count == 0) return;
            SetStatus("正在关闭平台…");
            foreach (var p in procs)
            {
                try { p.CloseMainWindow(); } catch { }
            }
            for (int i = 0; i < 32; i++)
            {
                Thread.Sleep(250);
                procs = procs.Where(p => { try { return !p.HasExited; } catch { return false; } }).ToList();
                if (procs.Count == 0) { Log("平台已关闭"); return; }
            }
            Log("平台没有响应关闭请求，正在强制结束…");
            foreach (var p in procs)
            {
                try { p.Kill(); p.WaitForExit(3000); } catch { }
            }
            Thread.Sleep(500);
            procs = procs.Where(p => { try { return !p.HasExited; } catch { return false; } }).ToList();
            if (procs.Count == 0) { Log("平台已强制关闭"); return; }
            throw new Exception("平台没有关闭，请手动退出平台（包括右下角托盘图标）后重新运行本程序");
        }
    }
}
