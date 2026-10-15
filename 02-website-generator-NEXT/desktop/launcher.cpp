// MURTHER FABRIQUE — Windows desktop shell.
//
// A window, an icon, and a WebView2. That is the whole program.
//
// Why this and not Electron: the application is already a single ~255 KB HTML
// file that runs with no server and no network. Electron would wrap it in a
// 150 MB copy of an engine Windows already ships, plus an updater, a crash
// reporter and a dependency tree to audit. The WebView2 Runtime is an operating
// system component on Windows 10 21H2 and Windows 11, so this file links only
// the loader that talks to it.
//
// Why a virtual host rather than file://: a mapped virtual host gives the page a
// real https origin, which is what localStorage needs for autosave. Over file://
// the origin is opaque and the project the user was working on would not
// survive a restart.
//
// The application is embedded as an RCDATA resource and unpacked to the user's
// profile on first run, keyed by a hash of its own bytes. That is what makes
// this a single file: there is nothing beside it to keep together.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>
#include <string>

#include <WebView2.h>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

constexpr wchar_t kVhost[] = L"murther-fabrique.local";
constexpr wchar_t kTitle[] = L"MURTHER FABRIQUE";
constexpr wchar_t kClassName[] = L"MurtherFabriqueWindow";
constexpr wchar_t kFolder[] = L"MurtherFabrique";

// Posted from DOMContentLoaded so the probe runs from the message loop rather
// than from inside the event callback.
constexpr UINT kSelftestMsg = WM_APP + 1;

// Matched by the .rc that build.ps1 generates from the repository's .ico.
constexpr int kIconId = 1;
constexpr int kAppHtmlId = 100;

ComPtr<ICoreWebView2Controller> gController;
// ICoreWebView2_2, not the base interface: add_DOMContentLoaded lives on it.
ComPtr<ICoreWebView2_2> gWebView;
HWND gWindow = nullptr;
bool gSelftest = false;
// Never cleared, unlike gSelftest: the self-test sets that one false as soon as
// it has its turn, and Say() keeps having to be able to write its log after it.
bool gLogToFile = false;
int gExit = 0;

/* ------------------------------------------------------------------ console */

// Defined below, next to the rest of the profile handling; Say writes its log
// there, so it needs to know the name before that point in the file.
std::wstring ProfileDir(const wchar_t* leaf);
std::wstring ProfileRoot();

// A GUI-subsystem executable has no stdout. Attaching to the parent's console is
// the standard way to make `--selftest` reportable from PowerShell, and it does
// nothing at all when there is no parent console to attach to.
//
// In self-test mode the same lines also go to a file, because a machine running
// the check may have no console to attach to at all and "no output" would be
// indistinguishable from "it hung".
void Say(const wchar_t* text) {
  static bool open = false;
  if (!open) {
    open = AttachConsole(ATTACH_PARENT_PROCESS) || AllocConsole();
    FILE* f = nullptr;
    (void)freopen_s(&f, "CONOUT$", "w", stdout);
    (void)freopen_s(&f, "CONOUT$", "w", stderr);
  }
  fwprintf(stdout, L"%s\n", text);
  fflush(stdout);

  if (gLogToFile) {
    ProfileDir(L"");
    const std::wstring log = ProfileRoot() + L"\\" + kFolder + L"\\selftest.txt";
    HANDLE h = CreateFileW(log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                           OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
      const int n = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
      std::string line;
      if (n > 1) {
        line.resize(static_cast<size_t>(n));
        WideCharToMultiByte(CP_UTF8, 0, text, -1, &line[0], n, nullptr, nullptr);
        line.resize(static_cast<size_t>(n - 1));
      }
      line += "\n";
      DWORD written = 0;
      SetFilePointer(h, 0, nullptr, FILE_END);
      WriteFile(h, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
      CloseHandle(h);
    }
  }
}

/* -------------------------------------------------------------- app payload */

// The profile root, with nothing created. ProfileDir creates a directory by
// design, so it must never be pointed at a file name -- it will happily make a
// directory called "selftest.txt" and then fail to open it.
std::wstring ProfileRoot() {
  wchar_t base[MAX_PATH] = {};
  const DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH);
  return (n && n < MAX_PATH) ? std::wstring(base) : std::wstring(L".");
}

// `leaf` is a sub-path and carries its own leading backslash.
std::wstring ProfileDir(const wchar_t* leaf) {
  const std::wstring dir = ProfileRoot() + L"\\" + kFolder + leaf;
  SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
  return dir;
}

// FNV-1a. Not a security primitive and not pretending to be one: it names a
// build so the launcher can tell "the application I embedded" from "the
// application already on disk", which is all it is for.
std::wstring Fingerprint(const BYTE* data, size_t size) {
  uint64_t h = 1469598103934665603ull;
  for (size_t i = 0; i < size; i++) {
    h ^= data[i];
    h *= 1099511628211ull;
  }
  wchar_t hex[20];
  swprintf_s(hex, L"%016llx", static_cast<unsigned long long>(h));
  return hex;
}

/**
 * Unpack the embedded application and return the full path of the file on disk.
 *
 * The file name carries the fingerprint, so an upgraded build writes a new file
 * rather than overwriting one a running instance is reading, and files from
 * previous builds can be swept without guessing which one is current.
 */
// The unpacked application, and the virtual-host URL it is served from. The
// file name is fingerprinted, so the URL is built from it rather than guessed:
// pointing the WebView at a name that does not exist produces an error page
// that looks a lot like a broken application.
std::wstring gAppFile;
std::wstring gAppUrl() {
  std::wstring url = std::wstring(L"https://") + kVhost + L"/" + gAppFile;
  if (gSelftest) url += L"?probe=1";
  return url;
}

std::wstring UnpackApp() {
HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(kAppHtmlId), RT_RCDATA);
  if (!res) return {};
  const size_t size = SizeofResource(nullptr, res);
  const BYTE* data = static_cast<const BYTE*>(LockResource(LoadResource(nullptr, res)));
  if (!data || !size) return {};

  const std::wstring dir = ProfileDir(L"\\app");
  const std::wstring path = dir + L"\\generator-" + Fingerprint(data, size) + L".html";

  if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) {
    const std::wstring tmp = path + L".part";
    HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    DWORD written = 0;
    BOOL ok = WriteFile(h, data, static_cast<DWORD>(size), &written, nullptr);
    ok = ok && CloseHandle(h);
    // Atomic replace: a half-written application is worse than none, and the
    // next launch would only try again.
    if (!ok || !MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING)) {
      DeleteFileW(tmp.c_str());
      return {};
    }
  }

  // Sweep older builds. The pattern is specific enough that nothing else in this
  // folder can match it, so this only ever deletes files we wrote.
  WIN32_FIND_DATAW fd;
  HANDLE find = FindFirstFileW((dir + L"\\generator-*.html").c_str(), &fd);
  if (find != INVALID_HANDLE_VALUE) {
    do {
      if (fd.cFileName[0] == L'.') continue;
      const std::wstring other = dir + L"\\" + fd.cFileName;
      if (_wcsicmp(other.c_str(), path.c_str()) != 0) DeleteFileW(other.c_str());
    } while (FindNextFileW(find, &fd));
    FindClose(find);
  }
  const size_t slash = path.find_last_of(L'\\');
  gAppFile = (slash == std::wstring::npos) ? path : path.substr(slash + 1);
  return path;
}

void CloseSoon();
void StartProbe();

/* ------------------------------------------------------------------ window */

void ResizeWebView() {
  if (!gController) return;
  RECT rc;
  GetClientRect(gWindow, &rc);
  gController->put_Bounds({rc.left, rc.top, rc.right, rc.bottom});
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE:
      ResizeWebView();
      return 0;
    case WM_GETMINMAXINFO: {
      // Below this the three-column editor has nowhere to put anything; letting
      // Windows honour a tiny window only produces a broken-looking application.
      auto* mmi = reinterpret_cast<MINMAXINFO*>(lp);
      mmi->ptMinTrackSize.x = 640;
      mmi->ptMinTrackSize.y = 480;
      return 0;
    }
    case WM_DPICHANGED: {
      // Per-monitor v2 moves and resizes the window for us; the WebView still
      // has to be told the new client area or it keeps the old scale.
      const auto* rect = reinterpret_cast<const RECT*>(lp);
      SetWindowPos(hwnd, nullptr, rect->left, rect->top, rect->right - rect->left,
                   rect->bottom - rect->top, SWP_NOZORDER | SWP_NOACTIVATE);
      return 0;
    }
    case WM_CLOSE:
      if (gController) gController->Close();
      DestroyWindow(hwnd);
      return 0;
    case kSelftestMsg:
      StartProbe();
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

/* ---------------------------------------------------------------- self-test */

// Two round trips on purpose: the details come back as a JSON string and the
// verdict comes back as a number that can be an exit code. Deciding pass or fail
// by sniffing a substring of the details would be a test that can lie.
constexpr wchar_t kProbe[] =
    L"(function(){var o={};try{"
    L"o.ready=!!window.wgn;"
    L"o.files=window.wgn?Object.keys(window.wgn.build().files).length:0;"
    L"o.selfCheck=window.wgn?window.wgn.errors().length:-1;"
    L"o.storage=(function(){try{localStorage.setItem('__mf','1');var v=localStorage.getItem('__mf')==='1';localStorage.removeItem('__mf');return v;}catch(e){return false;}})();"
    L"o.origin=location.origin;o.path=location.pathname;o.title=document.title;"
    L"o.viewport=innerWidth+'x'+innerHeight;"
    L"}catch(e){o.error=e.message}"
    L"return JSON.stringify(o)})()";
// The verdict recomputes everything instead of reading what the probe left
// behind. Two scripts submitted back to back are not ordered against each
// other, so a verdict that depended on a value the probe had not written yet
// would report a failure that is really a race.
//
// The viewport check is load-bearing. A 0x0 controller still loads the page and
// still runs every script, so the original version of this self-test passed on a
// window that showed the user nothing but black.
constexpr wchar_t kVerdict[] =
    L"(function(){try{"
    L"var ok=!!window.wgn;"
    L"var files=window.wgn?Object.keys(window.wgn.build().files).length:0;"
    L"var self=window.wgn?window.wgn.errors().length:-1;"
    L"var store=false;try{localStorage.setItem('__mf','1');store=localStorage.getItem('__mf')==='1';localStorage.removeItem('__mf');}catch(e){}"
    L"return (ok&&files>10&&self===0&&store&&innerWidth>=640&&innerHeight>=400)?0:1;"
    L"}catch(e){return 2}})()";

void CloseSoon() { PostMessage(gWindow, WM_CLOSE, 0, 0); }

// ExecuteScript answers through the message loop, not through the call. So the
// self-test posts a message, runs the probe from there, and lets the normal loop
// carry both answers back. Pumping re-entrantly from inside DOMContentLoaded is
// what made the first version return nothing at all.
std::wstring gProbeJson;
std::wstring gVerdictJson;

void StartProbe() {
  gProbeJson.clear();
  gVerdictJson.clear();
  gExit = 3;  // the watchdog's answer, unless a verdict replaces it

  const HRESULT probeHr = gWebView->ExecuteScript(
      kProbe, Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                  [](HRESULT code, LPCWSTR json) -> HRESULT {
                    if (json) gProbeJson = json;
                    Say(L"MURTHER FABRIQUE -- details");
                    Say(gProbeJson.empty() ? L"(the page returned nothing)" : gProbeJson.c_str());
                    return SUCCEEDED(code) ? S_OK : S_OK;
                  }).Get());

  const HRESULT verdictHr = gWebView->ExecuteScript(
      kVerdict, Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                    [](HRESULT code, LPCWSTR json) -> HRESULT {
                      if (json) gVerdictJson = json;
                      Say(L"MURTHER FABRIQUE -- verdict");
                      Say(gVerdictJson.empty() ? L"(the page returned nothing)" : gVerdictJson.c_str());
                      gExit = (SUCCEEDED(code) && gVerdictJson == L"0") ? 0 : 1;
                      CloseSoon();
                      return S_OK;
                    }).Get());

  if (FAILED(probeHr) || FAILED(verdictHr)) {
    Say(L"MURTHER FABRIQUE FAILED: the page refused to run the probe.");
    gExit = 4;
    CloseSoon();
  }
}

void ReportSelftest() {
  Say(L"MURTHER FABRIQUE -- packaged application self-test");
  Say((ProfileDir(L"\\app") + L"  <- unpacked to").c_str());
  PostMessage(gWindow, kSelftestMsg, 0, 0);
}

int Fail(const wchar_t* what) {
  Say(L"MURTHER FABRIQUE FAILED:");
  Say(what);
  Say(L"It needs the Microsoft Edge WebView2 Runtime (Evergreen), which ships");
  Say(L"with Windows 11 and Windows 10 21H2 and later.");
  // A self-test that stops on a modal dialog is a test that hangs CI. Report on
  // the console and exit; a person launching it gets the dialog.
  if (gLogToFile) return 2;
  MessageBoxW(nullptr, what, kTitle, MB_OK | MB_ICONERROR);
  return 2;
}

/* --------------------------------------------------------------- start-up */

void ConfigureWebView(ICoreWebView2_2* webview) {
  webview->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            // A window.open() from the page has nowhere to go inside a desktop
            // shell. Hand real web addresses to the user's browser and drop the
            // rest, rather than leaving a null window behind a button that looks
            // like it worked.
            LPWSTR uri = nullptr;
            if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
              if (wcsstr(uri, L"https://") == uri || wcsstr(uri, L"http://") == uri) {
                ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
              }
              CoTaskMemFree(uri);
            }
            args->put_Handled(TRUE);
            return S_OK;
          }).Get(),
      nullptr);

if (gSelftest) {
    webview->add_DOMContentLoaded(
        Callback<ICoreWebView2DOMContentLoadedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2DOMContentLoadedEventArgs*) -> HRESULT {
              if (gSelftest) {
                gSelftest = false;
                ReportSelftest();
              }
              return S_OK;
            }).Get(),
        nullptr);
  }
}

void OnControllerReady(HRESULT hr, ICoreWebView2Controller* controller) {
  if (FAILED(hr) || !controller) { Fail(L"The WebView2 controller could not be created."); CloseSoon(); return; }
  gController = controller;

ComPtr<ICoreWebView2> webview;
  if (FAILED(gController->get_CoreWebView2(&webview)) || !webview) {
    Fail(L"The WebView2 object could not be read.");
    CloseSoon();
    return;
  }
// The controller hands back the v1 interface. Everything this launcher uses
  // beyond the bare essentials is on v2/v3, and COM will not promote on its own.
  if (FAILED(webview.As(&gWebView))) {
    Fail(L"The WebView2 runtime is too old (ICoreWebView2_2 missing).");
    CloseSoon();
    return;
  }

  // Serve the unpacked application as https://murther-fabrique.local/, which is
  // what gives the page a real origin and therefore a working localStorage.
  // DENY_CORS: the application makes no cross-origin request and should not be
  // able to. It is the tighter of the two access modes and costs nothing here.
  ComPtr<ICoreWebView2_3> webview3;
  if (FAILED(gWebView.As(&webview3)) ||
      FAILED(webview3->SetVirtualHostNameToFolderMapping(
          kVhost, ProfileDir(L"\\app").c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
    Fail(L"The WebView2 runtime is too old (virtual host mapping missing).");
    CloseSoon();
    return;
  }

  ComPtr<ICoreWebView2Settings> settings;
  gWebView->get_Settings(&settings);
  if (settings) {
    // DevTools are a debugging surface, not a feature: everything the
    // application can do, it reports through its own quality panel.
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_AreDefaultContextMenusEnabled(TRUE);   // paste into a text field
    settings->put_AreDefaultScriptDialogsEnabled(TRUE);  // the project uses confirm()
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    settings->put_AreHostObjectsAllowed(FALSE);
  }

  ConfigureWebView(gWebView.Get());

  // Give the controller its size NOW, not on the next WM_SIZE.
  //
  // This is the whole bug the black window was: the WebView2 environment comes
  // up asynchronously, by which time the window has already been shown and
  // settled at its final size. No further WM_SIZE ever arrives, so the
  // controller keeps a 0x0 bounds, paints nothing, and the window shows its own
  // black background. The page loads, the scripts run, the self-test passes --
  // and the user sees nothing. Resize here, not only in the resize handler.
  gController->put_IsVisible(TRUE);
  ResizeWebView();

  const std::wstring url = gAppUrl();
  gWebView->Navigate(url.c_str());
}

void OnEnvironmentReady(HRESULT hr, ICoreWebView2Environment* env) {
  if (FAILED(hr) || !env) { Fail(L"The WebView2 runtime did not start."); CloseSoon(); return; }

  env->CreateCoreWebView2Controller(
      gWindow, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                   [](HRESULT h, ICoreWebView2Controller* c) -> HRESULT {
                     OnControllerReady(h, c);
                     return S_OK;
                   }).Get());
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, LPWSTR, int show) {
  // Per-monitor v2 before any window exists: doing it later leaves the first
  // frame rendered at the wrong scale on a mixed-DPI desktop.
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--selftest") == 0) { gSelftest = true; gLogToFile = true; }
  }
  if (argv) LocalFree(argv);

  if (UnpackApp().empty()) return Fail(L"The application could not be unpacked.");

  if (gSelftest) Say((ProfileDir(L"\\app") + L"  <- unpacked to").c_str());

  WNDCLASSEXW wc = {sizeof(wc)};
  wc.hInstance = inst;
  wc.lpfnWndProc = WndProc;
  wc.lpszClassName = kClassName;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(kIconId));
  wc.hIconSm = static_cast<HICON>(LoadImageW(inst, MAKEINTRESOURCEW(kIconId), IMAGE_ICON,
                                              GetSystemMetrics(SM_CXSMICON),
                                              GetSystemMetrics(SM_CYSMICON), 0));
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
  if (!RegisterClassExW(&wc)) return Fail(L"The window class could not be registered.");

  const int screenW = GetSystemMetrics(SM_CXSCREEN);
  const int screenH = GetSystemMetrics(SM_CYSCREEN);
  const int width = (screenW >= 1600) ? 1440 : screenW - 160;
  const int height = (screenH >= 1000) ? 900 : screenH - 120;
  gWindow = CreateWindowExW(0, kClassName, kTitle, WS_OVERLAPPEDWINDOW,
                            (screenW - width) / 2, (screenH - height) / 2,
                            width, height, nullptr, nullptr, inst, nullptr);
  if (!gWindow) return Fail(L"The window could not be created.");

  // The WebView profile has to live outside the executable's folder, or the exe
  // is no longer portable: it cannot write beside itself on a USB stick.
  const std::wstring userData = ProfileDir(L"\\webview2");

  CreateCoreWebView2EnvironmentWithOptions(
      nullptr, userData.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
            OnEnvironmentReady(hr, env);
            return S_OK;
          }).Get());

  ShowWindow(gWindow, show);
  UpdateWindow(gWindow);

MSG msg;
  // The self-test must terminate on its own: a hung window would otherwise sit
  // there until somebody clicked it, and "the test passed" would be a claim
  // nobody checked.
  const DWORD deadline = gSelftest ? (GetTickCount() + 60000) : 0;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    if (gSelftest && GetTickCount() > deadline) {
      Say(L"MURTHER FABRIQUE FAILED: the self-test timed out after 60s.");
      gExit = 3;
      break;
    }
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  CoUninitialize();
  return gExit;
}
