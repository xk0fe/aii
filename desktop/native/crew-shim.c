// `crew`, `crew-status` and `crew-hook` on Windows (bin/win32-<arch>/*.exe): this one program under three names. It
// runs bin/crew.mjs, one folder up from it, with Crew's own runtime, as `crew.mjs <its name> <its arguments>`, passing
// the arguments exactly as it got them. A program, because anything can start one with every argument intact (Claude
// Code's hooks start crew-hook.exe with no shell at all; Codex's go through PowerShell or cmd), where cmd.exe would
// cut a .cmd's argument at its first newline and read & | % " in it its own way, and PowerShell runs a .ps1 before
// anything else of the name, or refuses to under the default execution policy. (Git Bash finds bin/crew and
// bin/crew-status, the sh scripts, first: core/launch.js withTools.)
//
// Crew's runtime is its own Electron binary run as Node: CREW_NODE says where it is (core/hub.js sets it for every
// agent), or else node.exe on PATH. ELECTRON_RUN_AS_NODE=1 is set here, for that one process: in the agent's own
// environment it would turn every Electron app the agent starts into Node.
//
// The child gets this program's stdin, stdout and stderr, and its exit code comes back as this program's. It goes when
// this program goes (a CLI stopping a status line or hook that took too long stops this one).
//
// Built with zig (node scripts/build-shims.mjs); the .exe files are committed, so nothing needs building on Windows.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define MAX_LINE 32768

static void say(const char *text) {
  DWORD n;
  HANDLE err = GetStdHandle(STD_ERROR_HANDLE);
  if (err && err != INVALID_HANDLE_VALUE) WriteFile(err, text, lstrlenA(text), &n, NULL);
}

// What follows the program's name in a command line, where CommandLineToArgvW would end that name.
static const wchar_t *after_program(const wchar_t *p) {
  if (*p == L'"') {
    for (p++; *p && *p != L'"'; p++) {}
    if (*p) p++;
  } else {
    while (*p && *p != L' ' && *p != L'\t') p++;
  }
  while (*p == L' ' || *p == L'\t') p++;
  return p;
}

static int append(wchar_t *to, const wchar_t *text) {
  if (lstrlenW(to) + lstrlenW(text) >= MAX_LINE) return 0;
  lstrcatW(to, text);
  return 1;
}

// A handle the child can inherit (ours may not be marked so), or NULL when there's none.
static HANDLE std_handle(DWORD which) {
  HANDLE h = GetStdHandle(which);
  if (h == INVALID_HANDLE_VALUE) return NULL;
  if (h) SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  return h;
}

// Ctrl+C reaches the child too, in the same console: this program waits for it to finish rather than going first. (A
// routine, not SetConsoleCtrlHandler(NULL, TRUE), which the child would inherit and then ignore Ctrl+C too.)
static BOOL WINAPI wait_for_child(DWORD event) {
  (void)event;
  return TRUE;
}

// A job that ends the child with this program, whatever ends it, with an attribute list that starts the child in it.
static LPPROC_THREAD_ATTRIBUTE_LIST in_job(HANDLE *job) {
  *job = CreateJobObjectW(NULL, NULL);
  if (!*job) return NULL;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &size);
  LPPROC_THREAD_ATTRIBUTE_LIST list = HeapAlloc(GetProcessHeap(), 0, size);
  if (list && SetInformationJobObject(*job, JobObjectExtendedLimitInformation, &limits, sizeof limits) &&
      InitializeProcThreadAttributeList(list, 1, 0, &size)) {
    if (UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, job, sizeof *job, NULL, NULL)) return list;
    DeleteProcThreadAttributeList(list);
  }
  return NULL;
}

int main(void) {
  static wchar_t self[MAX_LINE], script[MAX_LINE], runtime[MAX_LINE], line[MAX_LINE], name[MAX_PATH];

  DWORD n = GetModuleFileNameW(NULL, self, MAX_LINE);
  if (!n || n >= MAX_LINE) return say("crew: can't tell where this program is\n"), 1;
  wchar_t *slash = self + n;
  while (slash > self && *slash != L'\\' && *slash != L'/') slash--;
  if (lstrlenW(slash + 1) >= MAX_PATH) return say("crew: this program's name is too long\n"), 1;
  lstrcpyW(name, slash + 1);
  for (wchar_t *dot = name + lstrlenW(name); dot > name; dot--) {
    if (*dot == L'.') {
      *dot = 0;
      break;
    }
  }
  slash[1] = 0;
  if (!append(self, L"..\\crew.mjs") || !GetFullPathNameW(self, MAX_LINE, script, NULL)) return say("crew: can't find crew.mjs\n"), 1;

  DWORD got = GetEnvironmentVariableW(L"CREW_NODE", runtime, MAX_LINE);
  if (!got || got >= MAX_LINE) {
    if (!SearchPathW(NULL, L"node.exe", NULL, MAX_LINE, runtime, NULL)) {
      return say("crew: CREW_NODE isn't set (Crew sets it for its agents) and there's no node.exe on PATH\n"), 1;
    }
  }

  // "<runtime>" "<script>" <name> <arguments as given>. Neither path can hold a quote or end in a backslash.
  line[0] = 0;
  if (!(append(line, L"\"") && append(line, runtime) && append(line, L"\" \"") && append(line, script) && append(line, L"\" ") &&
        append(line, name) && append(line, L" ") && append(line, after_program(GetCommandLineW())))) {
    return say("crew: the command line is too long\n"), 1;
  }

  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
  SetConsoleCtrlHandler(wait_for_child, TRUE);

  STARTUPINFOEXW si = {0};
  si.StartupInfo.cb = sizeof si;
  si.StartupInfo.dwFlags = STARTF_USESTDHANDLES; // Crew's Electron binary is a GUI program: no handles unless given these
  si.StartupInfo.hStdInput = std_handle(STD_INPUT_HANDLE);
  si.StartupInfo.hStdOutput = std_handle(STD_OUTPUT_HANDLE);
  si.StartupInfo.hStdError = std_handle(STD_ERROR_HANDLE);
  HANDLE job = NULL;
  si.lpAttributeList = in_job(&job);
  PROCESS_INFORMATION pi;
  BOOL started = si.lpAttributeList && CreateProcessW(runtime, line, NULL, NULL, TRUE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL, &si.StartupInfo, &pi);
  if (!started) { // no job, then
    si.StartupInfo.cb = sizeof si.StartupInfo;
    started = CreateProcessW(runtime, line, NULL, NULL, TRUE, 0, NULL, NULL, &si.StartupInfo, &pi);
  }
  if (!started) {
    say("crew: can't start Crew's runtime (CREW_NODE): is Crew still installed where it was?\n");
    return 1;
  }
  CloseHandle(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}
