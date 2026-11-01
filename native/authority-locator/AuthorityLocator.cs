using System;
using System.Runtime.InteropServices;
public static class AuthorityLocator {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr result);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError=true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    public static int Main(string[] args) {
        if(args.Length!=1 || args[0]!="--user-profile") return 2;
        IntPtr result=IntPtr.Zero,token=IntPtr.Zero;
        try {
            // Profile is outside AppData's per-package write virtualization.
            Guid id=new Guid("5E6C858F-0E22-4760-9AFE-EA3317B67173");
            if(!OpenProcessToken(GetCurrentProcess(),0x0008,out token)) return 3;
            int hr=SHGetKnownFolderPath(ref id,0,token,out result);
            if(hr!=0) Marshal.ThrowExceptionForHR(hr);
            string value=Marshal.PtrToStringUni(result);
            if(String.IsNullOrEmpty(value)) return 3;
            Console.OutputEncoding=new System.Text.UTF8Encoding(false);
            Console.Write(value);return 0;
        } catch(Exception error) {Console.Error.Write(error.GetType().Name);return 3;}
        finally {if(result!=IntPtr.Zero)Marshal.FreeCoTaskMem(result);if(token!=IntPtr.Zero)CloseHandle(token);}
    }
}
