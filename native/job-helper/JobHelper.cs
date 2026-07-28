using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class JobHelper
{
    private const int ProtocolVersion = 2;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0;
    private const int JobObjectExtendedLimitInformation = 9;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST = new IntPtr(0x0002000D);

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly object OutputLock = new object();
    private static readonly object StateLock = new object();
    private static readonly Dictionary<string, OwnedJob> Jobs = new Dictionary<string, OwnedJob>();
    private static readonly ManualResetEvent Stopping = new ManualResetEvent(false);
    private static IntPtr ParentHandle = IntPtr.Zero;
    private static Thread ParentThread;

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--protocol-version=2")
        {
            Console.Out.WriteLine("2");
            return 0;
        }

        int parentPid;
        if (!TryReadParentPid(args, out parentPid))
        {
            Console.Error.WriteLine("Missing or invalid --parent-pid.");
            return 2;
        }

        ParentHandle = OpenProcess(SYNCHRONIZE, false, parentPid);
        if (ParentHandle == IntPtr.Zero)
        {
            Console.Error.WriteLine("OpenProcess(parent) failed: " + Marshal.GetLastWin32Error());
            return 3;
        }

        ParentThread = new Thread(MonitorParent) { IsBackground = true, Name = "job-helper-parent-monitor" };
        ParentThread.Start();
        Emit(new Dictionary<string, object> {
            { "type", "ready" },
            { "protocolVersion", ProtocolVersion },
            { "pid", Process.GetCurrentProcess().Id },
            { "creationFileTime", ProcessCreationFileTime(Process.GetCurrentProcess().Handle) }
        });

        try
        {
            string line;
            while (!Stopping.WaitOne(0) && (line = Console.In.ReadLine()) != null)
            {
                HandleLine(line);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
        }
        finally
        {
            ShutdownAndJoin();
            if (ParentHandle != IntPtr.Zero) CloseHandle(ParentHandle);
            ParentHandle = IntPtr.Zero;
        }
        return 0;
    }

    private static bool TryReadParentPid(string[] args, out int parentPid)
    {
        parentPid = 0;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--parent-pid=", StringComparison.Ordinal) &&
                int.TryParse(arg.Substring("--parent-pid=".Length), out parentPid) &&
                parentPid > 0) return true;
        }
        return false;
    }

    private static void MonitorParent()
    {
        var handles = new[] { ParentHandle, Stopping.SafeWaitHandle.DangerousGetHandle() };
        if (WaitForMultipleObjects((uint)handles.Length, handles, false, 0xFFFFFFFF) == WAIT_OBJECT_0)
            RequestStop();
    }

    private static void HandleLine(string line)
    {
        Dictionary<string, object> message;
        try
        {
            message = Json.Deserialize<Dictionary<string, object>>(line);
        }
        catch (Exception error)
        {
            EmitError(null, "protocol", "Invalid JSON command: " + error.Message, 0);
            return;
        }

        string type = ReadString(message, "type");
        if (type == "start") StartOwnedProcess(message);
        else if (type == "terminate") TerminateOwnedProcess(ReadString(message, "id"), ReadString(message, "reason") == "timeout" ? "timeout" : "terminated");
        else if (type == "shutdown") RequestStop();
        else EmitError(ReadString(message, "id"), "protocol", "Unsupported command type.", 0);
    }

    private static void StartOwnedProcess(Dictionary<string, object> message)
    {
        string id = ReadString(message, "id");
        string jobInstanceId = ReadString(message, "jobInstanceId");
        string command = ReadString(message, "command");
        string cwd = ReadString(message, "cwd");
        var arguments = ReadStringArray(message, "args");
#if !TEST_FAULTS
        if (message.ContainsKey("testFault"))
        {
            EmitError(id, "protocol", "testFault is not supported by the production helper.", 0);
            return;
        }
#endif
        if (String.IsNullOrWhiteSpace(id) || String.IsNullOrWhiteSpace(command) || !IsUuid(jobInstanceId))
        {
            EmitError(id, "create", "start requires id, command, and UUID jobInstanceId.", 0);
            return;
        }

        lock (StateLock)
        {
            if (Stopping.WaitOne(0))
            {
                EmitError(id, "cancelled", "Helper is shutting down.", 0);
                return;
            }
            if (Jobs.ContainsKey(id))
            {
                EmitError(id, "protocol", "Duplicate job id.", 0);
                return;
            }
        }

        PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
        IntPtr jobHandle = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr jobListValue = IntPtr.Zero;
        bool attributeListInitialized = false;
        try
        {
            jobHandle = CreateJobObjectW(IntPtr.Zero, null);
            if (jobHandle == IntPtr.Zero) throw NativeFailure("job", "CreateJobObjectW failed.");
            ConfigureKillOnClose(jobHandle);
            ConfirmNotInheritable(jobHandle);

            UIntPtr attributeListSize = UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
            attributeList = Marshal.AllocHGlobal(checked((int)attributeListSize.ToUInt64()));
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                throw NativeFailure("assign", "InitializeProcThreadAttributeList failed.");
            attributeListInitialized = true;
            jobListValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobListValue, jobHandle);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST,
                jobListValue,
                new UIntPtr((uint)IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
                throw NativeFailure("assign", "UpdateProcThreadAttribute(JOB_LIST) failed.");

            var startupInfo = new STARTUPINFOEX();
            startupInfo.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startupInfo.lpAttributeList = attributeList;
            var commandLine = new StringBuilder(BuildCommandLine(command, arguments));
            bool created = CreateProcessW(
                command,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero,
                String.IsNullOrWhiteSpace(cwd) ? null : cwd,
                ref startupInfo,
                out processInfo);
            if (!created) throw NativeFailure("create", "CreateProcessW with Job list failed.");

#if TEST_FAULTS
            if (ReadString(message, "testFault") == "failfast-after-create-with-job")
            {
                string evidencePath = ReadString(message, "testEvidencePath");
                if (!String.IsNullOrWhiteSpace(evidencePath))
                    File.WriteAllText(evidencePath, processInfo.dwProcessId.ToString());
                Environment.FailFast("Injected helper crash after atomic Job-bound create.");
            }
            if (ReadString(message, "testFault") == "after-create-before-assign")
                throw new NativeStageException("create", "Injected failure after atomic Job-bound create.", 0);
#endif

#if TEST_FAULTS
            if (ReadString(message, "testFault") == "after-assign-before-resume")
                throw new NativeStageException("assign", "Injected failure after atomic Job-bound create.", 0);
#endif

            if (Stopping.WaitOne(0) || WaitForSingleObject(ParentHandle, 0) == WAIT_OBJECT_0)
                throw new InvalidOperationException("Ownership cancelled before resume.");

#if TEST_FAULTS
            if (ReadString(message, "testFault") == "resume-fail")
                throw NativeFailure("resume", "Injected ResumeThread failure.", 5);
#endif

            uint resumeResult = ResumeThread(processInfo.hThread);
            if (resumeResult == 0xFFFFFFFF) throw NativeFailure("resume", "ResumeThread failed.");
            CloseHandle(processInfo.hThread);
            processInfo.hThread = IntPtr.Zero;

#if TEST_FAULTS
            if (ReadString(message, "testFault") == "close-job-after-resume")
            {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
                WaitForSingleObject(processInfo.hProcess, 5000);
                throw new InvalidOperationException("Injected Job handle closure after resume.");
            }
#endif

            string childCreationFileTime = ProcessCreationFileTime(processInfo.hProcess);
            var ownedJob = new OwnedJob(id, jobInstanceId, jobHandle, processInfo.hProcess, processInfo.dwProcessId, childCreationFileTime);
            var completionThread = new Thread(delegate() { MonitorCompletion(ownedJob); }) {
                IsBackground = true,
                Name = "job-helper-completion-" + id
            };
            ownedJob.CompletionThread = completionThread;
            lock (StateLock)
            {
                if (Stopping.WaitOne(0)) throw new InvalidOperationException("Ownership cancelled before publication.");
                Jobs.Add(id, ownedJob);
            }
            jobHandle = IntPtr.Zero;
            processInfo.hProcess = IntPtr.Zero;
            bool completionStarted = false;
            try
            {
                completionThread.Start();
                completionStarted = true;
                Emit(new Dictionary<string, object> {
                    { "type", "owned" },
                    { "id", id },
                    { "jobInstanceId", ownedJob.JobInstanceId },
                    { "helperPid", Process.GetCurrentProcess().Id },
                    { "helperCreationFileTime", ProcessCreationFileTime(Process.GetCurrentProcess().Handle) },
                    { "pid", ownedJob.ProcessId },
                    { "creationFileTime", ownedJob.CreationFileTime }
                });
                ownedJob.Publish();
            }
            catch
            {
                ownedJob.RequestTermination("publication-failed");
                ownedJob.Publish();
                if (completionStarted)
                {
                    completionThread.Join();
                }
                else
                {
                    lock (StateLock) Jobs.Remove(id);
                    WaitForSingleObject(ownedJob.ProcessHandle, 5000);
                    ownedJob.CloseJob();
                    ownedJob.CloseProcess();
                    ownedJob.ClosePublicationGate();
                }
                throw;
            }
        }
        catch (Exception error)
        {
            if (jobHandle != IntPtr.Zero)
            {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
            }
            if (processInfo.hProcess != IntPtr.Zero)
            {
                WaitForSingleObject(processInfo.hProcess, 5000);
            }
            if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
            if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
            if (jobHandle != IntPtr.Zero) CloseHandle(jobHandle);
            var native = error as NativeStageException;
            EmitError(id, native == null ? InferStage(error) : native.Stage, error.Message,
                native == null ? 0 : native.Win32Error, processInfo.dwProcessId);
        }
        finally
        {
            if (attributeList != IntPtr.Zero)
            {
                if (attributeListInitialized) DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (jobListValue != IntPtr.Zero) Marshal.FreeHGlobal(jobListValue);
        }
    }

    private static void MonitorCompletion(OwnedJob job)
    {
        WaitForSingleObject(job.ProcessHandle, 0xFFFFFFFF);
        job.WaitUntilPublished();
        uint exitCode;
        if (!GetExitCodeProcess(job.ProcessHandle, out exitCode)) exitCode = 1;

        bool publish;
        string reason = job.TerminationReason;
        lock (StateLock)
        {
            publish = Jobs.Remove(job.Id);
        }
        job.CloseJob();
        job.CloseProcess();
        if (publish)
        {
            Emit(new Dictionary<string, object> {
                { "type", "completed" },
                { "id", job.Id },
                { "exitCode", unchecked((int)exitCode) },
                { "reason", reason }
            });
        }
    }

    private static void TerminateOwnedProcess(string id, string reason)
    {
        OwnedJob job = null;
        lock (StateLock)
        {
            if (!String.IsNullOrWhiteSpace(id)) Jobs.TryGetValue(id, out job);
        }
        if (job == null) return;
        job.RequestTermination(reason);
    }

    private static void RequestStop()
    {
        if (!Stopping.WaitOne(0)) Stopping.Set();
        List<OwnedJob> jobs;
        lock (StateLock)
        {
            jobs = new List<OwnedJob>(Jobs.Values);
        }
        foreach (OwnedJob job in jobs) job.RequestTermination("shutdown");
    }

    private static void ShutdownAndJoin()
    {
        RequestStop();
        List<OwnedJob> jobs;
        lock (StateLock) jobs = new List<OwnedJob>(Jobs.Values);
        foreach (OwnedJob job in jobs)
        {
            Thread completion = job.CompletionThread;
            if (completion != null && completion != Thread.CurrentThread) completion.Join();
        }
        if (ParentThread != null && ParentThread != Thread.CurrentThread) ParentThread.Join();
    }

    private static void ConfigureKillOnClose(IntPtr jobHandle)
    {
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ref limits, (uint)length))
            throw NativeFailure("job", "SetInformationJobObject failed.");
    }

    private static void ConfirmNotInheritable(IntPtr jobHandle)
    {
        if (!SetHandleInformation(jobHandle, HANDLE_FLAG_INHERIT, 0))
            throw NativeFailure("job", "SetHandleInformation failed.");
        uint flags;
        if (!GetHandleInformation(jobHandle, out flags))
            throw NativeFailure("job", "GetHandleInformation failed.");
        if ((flags & HANDLE_FLAG_INHERIT) != 0)
            throw new NativeStageException("job", "Job handle remained inheritable.", 0);
    }

    private static string BuildCommandLine(string command, string[] args)
    {
        var parts = new List<string>();
        parts.Add(QuoteArgument(command));
        foreach (string arg in args) parts.Add(QuoteArgument(arg));
        return String.Join(" ", parts.ToArray());
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        var result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { backslashes++; continue; }
            if (ch == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(ch);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static string ReadString(Dictionary<string, object> value, string key)
    {
        object raw;
        return value != null && value.TryGetValue(key, out raw) && raw != null ? Convert.ToString(raw) : null;
    }

    private static string[] ReadStringArray(Dictionary<string, object> value, string key)
    {
        object raw;
        if (!value.TryGetValue(key, out raw) || raw == null) return new string[0];
        var values = new List<string>();
        var enumerable = raw as IEnumerable;
        if (enumerable == null || raw is string) return new string[0];
        foreach (object item in enumerable) values.Add(Convert.ToString(item));
        return values.ToArray();
    }

    private static string InferStage(Exception error)
    {
        string message = error.Message ?? "";
        if (message.IndexOf("resume", StringComparison.OrdinalIgnoreCase) >= 0) return "resume";
        if (message.IndexOf("assign", StringComparison.OrdinalIgnoreCase) >= 0) return "assign";
        if (message.IndexOf("Job handle", StringComparison.OrdinalIgnoreCase) >= 0) return "job";
        return "create";
    }

    private static bool IsUuid(string value)
    {
        Guid parsed;
        return !String.IsNullOrWhiteSpace(value) && Guid.TryParseExact(value, "D", out parsed);
    }

    private static string ProcessCreationFileTime(IntPtr processHandle)
    {
        FILETIME creation, exit, kernel, user;
        if (!GetProcessTimes(processHandle, out creation, out exit, out kernel, out user))
            throw NativeFailure("identity", "GetProcessTimes failed.");
        ulong value = ((ulong)creation.dwHighDateTime << 32) | creation.dwLowDateTime;
        return value.ToString(CultureInfo.InvariantCulture);
    }

    private static NativeStageException NativeFailure(string stage, string message)
    {
        return NativeFailure(stage, message, Marshal.GetLastWin32Error());
    }

    private static NativeStageException NativeFailure(string stage, string message, int error)
    {
        return new NativeStageException(stage, message + " Win32Error=" + error, error);
    }

    private static void EmitError(string id, string stage, string message, int win32Error, uint pid = 0)
    {
        var payload = new Dictionary<string, object> {
            { "type", "error" },
            { "id", id },
            { "stage", stage },
            { "message", message },
            { "win32Error", win32Error }
        };
        if (pid != 0) payload.Add("pid", pid);
        Emit(payload);
    }

    private static void Emit(Dictionary<string, object> message)
    {
        lock (OutputLock)
        {
            Console.Out.WriteLine(Json.Serialize(message));
            Console.Out.Flush();
        }
    }

    private sealed class OwnedJob
    {
        private IntPtr jobHandle;
        private IntPtr processHandle;
        private readonly object reasonLock = new object();
        private readonly ManualResetEvent published = new ManualResetEvent(false);
        private int publicationGateClosed;
        private string terminationReason;
        public readonly string Id;
        public readonly string JobInstanceId;
        public readonly uint ProcessId;
        public readonly string CreationFileTime;
        public Thread CompletionThread;
        public IntPtr ProcessHandle { get { return processHandle; } }
        public string TerminationReason { get { lock (reasonLock) return terminationReason; } }

        public OwnedJob(string id, string jobInstanceId, IntPtr jobHandle, IntPtr processHandle, uint processId, string creationFileTime)
        {
            Id = id;
            JobInstanceId = jobInstanceId;
            this.jobHandle = jobHandle;
            this.processHandle = processHandle;
            ProcessId = processId;
            CreationFileTime = creationFileTime;
        }

        public void RequestTermination(string reason)
        {
            lock (reasonLock)
            {
                if (terminationReason == null) terminationReason = reason;
            }
            CloseJob();
        }

        public void Publish()
        {
            published.Set();
        }

        public void WaitUntilPublished()
        {
            published.WaitOne();
            ClosePublicationGate();
        }

        public void ClosePublicationGate()
        {
            if (Interlocked.Exchange(ref publicationGateClosed, 1) == 0) published.Close();
        }

        public void CloseJob()
        {
            IntPtr handle = Interlocked.Exchange(ref jobHandle, IntPtr.Zero);
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }

        public void CloseProcess()
        {
            IntPtr handle = Interlocked.Exchange(ref processHandle, IntPtr.Zero);
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }

    private sealed class NativeStageException : Exception
    {
        public readonly string Stage;
        public readonly int Win32Error;
        public NativeStageException(string stage, string message, int win32Error) : base(message)
        {
            Stage = stage;
            Win32Error = win32Error;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetHandleInformation(IntPtr handle, out uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out FILETIME creationTime, out FILETIME exitTime,
        out FILETIME kernelTime, out FILETIME userTime);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, uint flags, ref UIntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute,
        IntPtr value, UIntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
