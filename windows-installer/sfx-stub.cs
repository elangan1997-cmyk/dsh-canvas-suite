using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Windows.Forms;

// Small dependency-free launcher used for payloads larger than IExpress' CD-ROM limit.
// The build script appends a ZIP after the DSH_PAYLOAD_V1 marker.
internal static class Program
{
    private static readonly byte[] Marker = Encoding.ASCII.GetBytes("DSH_PAYLOAD_V1\n");

    public static int Main()
    {
        string self = Process.GetCurrentProcess().MainModule.FileName;
        try
        {
            using (var source = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long payloadOffset = FindPayload(source);
                if (payloadOffset < 0) throw new InvalidDataException("安装包缺少 payload 数据");

                string tempRoot = Path.Combine(Path.GetTempPath(), "dsh-setup-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(tempRoot);
                string archive = Path.Combine(tempRoot, "payload.zip");
                try
                {
                    Console.WriteLine("DSH Desktop 安装程序已启动，请勿关闭此窗口。");
                    source.Position = payloadOffset;
                    using (var output = new FileStream(archive, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        long totalBytes = source.Length - payloadOffset;
                        long copiedBytes = 0;
                        int lastPercent = -1;
                        byte[] copyBuffer = new byte[1024 * 1024];
                        int copyRead;
                        while ((copyRead = source.Read(copyBuffer, 0, copyBuffer.Length)) > 0)
                        {
                            output.Write(copyBuffer, 0, copyRead);
                            copiedBytes += copyRead;
                            int percent = totalBytes == 0 ? 100 : (int)((copiedBytes * 100L) / totalBytes);
                            if (percent != lastPercent)
                            {
                                Console.Write("\r[1/3] 正在准备安装包：{0}%（{1:N0}/{2:N0} 字节）", percent, copiedBytes, totalBytes);
                                lastPercent = percent;
                            }
                        }
                        output.Flush();
                        Console.WriteLine();
                    }
                    string testMode = Environment.GetEnvironmentVariable("DSH_SFX_TEST");
                    if (testMode == "1")
                    {
                        Console.WriteLine("DSH SFX payload copied: " + new FileInfo(archive).Length + " bytes");
                        return 0;
                    }
                    string extractRoot = Path.Combine(tempRoot, "payload");
                    ExtractPayload(archive, extractRoot);
                    if (testMode == "3")
                    {
                        Console.WriteLine("[3/3] 解压验证完成。");
                        return 0;
                    }
                    Console.WriteLine("[3/3] 文件解压完成，正在安装 DSH Desktop…");
                    string installer = Path.Combine(extractRoot, "install-release.ps1");
                    if (!File.Exists(installer)) throw new InvalidDataException("安装包缺少发布安装脚本");
                    string powerShell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
                    if (!File.Exists(powerShell)) powerShell = "powershell.exe";
                    var start = new ProcessStartInfo(powerShell)
                    {
                        Arguments = testMode == "2" ? "-NoLogo -NoProfile -Command \"Write-Output 'DSH PowerShell launch probe passed'; exit 0\"" : "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + installer + "\"",
                        WorkingDirectory = extractRoot,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        StandardOutputEncoding = new UTF8Encoding(false),
                        StandardErrorEncoding = new UTF8Encoding(false)
                    };
                    using (var child = Process.Start(start))
                    {
                        var standardOutput = new StringBuilder();
                        var standardError = new StringBuilder();
                        child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
                        {
                            if (args.Data == null) return;
                            Console.WriteLine(args.Data);
                            lock (standardOutput) standardOutput.AppendLine(args.Data);
                        };
                        child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
                        {
                            if (args.Data == null) return;
                            Console.Error.WriteLine(args.Data);
                            lock (standardError) standardError.AppendLine(args.Data);
                        };
                        child.BeginOutputReadLine();
                        child.BeginErrorReadLine();
                        child.WaitForExit();
                        int code = child.ExitCode;
                        string logRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DSH", "Logs");
                        Directory.CreateDirectory(logRoot);
                        string sfxLog = Path.Combine(logRoot, "sfx-installer.log");
                        string outputText = standardOutput.ToString();
                        string errorText = standardError.ToString();
                        File.AppendAllText(sfxLog, "[" + DateTime.Now.ToString("s") + "] exit=" + code + Environment.NewLine + outputText + errorText + Environment.NewLine, new UTF8Encoding(true));
                        if (code != 0)
                        {
                            string detail = string.IsNullOrWhiteSpace(errorText) ? outputText : errorText;
                            if (detail.Length > 600) detail = detail.Substring(detail.Length - 600);
                            string message = "DSH Desktop 安装失败（退出码 " + code + "）。\n请确认已完全退出 DSH 后重试。\n\n" + detail + "\n\n详细日志：%LOCALAPPDATA%\\DSH\\Logs\\sfx-installer.log";
                            try { MessageBox.Show(message, "DSH Desktop 安装", MessageBoxButtons.OK, MessageBoxIcon.Error); } catch { Console.Error.WriteLine(message); }
                        }
                        else if (testMode != "2") Console.WriteLine("[3/3] DSH Desktop 安装完成。");
                        return code;
                    }
                }
                finally
                {
                    try { Directory.Delete(tempRoot, true); } catch { }
                }
            }
        }
        catch (Exception ex)
        {
            string message = "DSH 安装包启动失败：" + ex.Message;
            try { MessageBox.Show(message, "DSH Desktop 安装", MessageBoxButtons.OK, MessageBoxIcon.Error); } catch { Console.Error.WriteLine(message); }
            return 1;
        }
    }

    private static void ExtractPayload(string archive, string extractRoot)
    {
        Directory.CreateDirectory(extractRoot);
        string safeRoot = Path.GetFullPath(extractRoot + Path.DirectorySeparatorChar);
        using (var zip = ZipFile.OpenRead(archive))
        {
            int total = zip.Entries.Count;
            for (int index = 0; index < total; index++)
            {
                ZipArchiveEntry entry = zip.Entries[index];
                string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string destination = Path.GetFullPath(Path.Combine(extractRoot, relative));
                if (!destination.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("安装包包含非法路径：" + entry.FullName);
                if (string.IsNullOrEmpty(entry.Name))
                    Directory.CreateDirectory(destination);
                else
                {
                    string parent = Path.GetDirectoryName(destination);
                    if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    entry.ExtractToFile(destination, true);
                }
                int done = index + 1;
                if (done == 1 || done == total || done % 250 == 0)
                {
                    int percent = total == 0 ? 100 : (int)Math.Floor(done * 100.0 / total);
                    string current = entry.FullName;
                    if (current.Length > 90) current = "…" + current.Substring(current.Length - 89);
                    Console.WriteLine("[2/3] 正在解压文件：{0}%（{1:N0}/{2:N0}） {3}", percent, done, total, current);
                }
            }
        }
    }

    private static long FindPayload(FileStream source)
    {
        int length = (int)Math.Min(source.Length, 16 * 1024 * 1024L);
        byte[] buffer = new byte[length];
        source.Position = 0;
        int read = 0;
        while (read < length)
        {
            int n = source.Read(buffer, read, length - read);
            if (n <= 0) break;
            read += n;
        }
        for (int i = 0; i <= read - Marker.Length; i++)
        {
            bool match = true;
            for (int j = 0; j < Marker.Length; j++)
                if (buffer[i + j] != Marker[j]) { match = false; break; }
            if (match) return i + Marker.Length;
        }
        return -1;
    }
}

