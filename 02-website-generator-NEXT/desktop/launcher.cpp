// MURTHER FABRIQUE — Windows desktop shell.
//
// A window, an icon, a two-button chooser, and a WebView2. That is the whole
// program.
//
// It opens either generator in this repository: NEXT, the current one, and
// ORIGINAL, the archived first version. Both are single self-contained HTML
// files and both are compiled into this executable, so the choice still costs
// the user nothing to download and nothing to install.
//
// Why this and not Electron: the applications are already single HTML files
// that run with no server and no network. Electron would wrap them in a 150 MB
// copy of an engine Windows already ships, plus an updater, a crash reporter
// and a dependency tree to audit. The WebView2 Runtime is an operating system
// component on Windows 10 21H2 and Windows 11, so this file links only the
// loader that talks to it.
//
// Why a virtual host rather than file://: a mapped virtual host gives the page a
// real https origin, which is what localStorage needs for autosave. Over file://
// the origin is opaque and the project the user was working on would not
// survive a restart.
//
// The applications are embedded as RCDATA resources and unpacked to the user's
// profile on first run, keyed by a hash of their own bytes. That is what makes
// this a single file: there is nothing beside it to keep together.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>
#include <string>
#include <vector>

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

// Matched by the .rc that build.ps1 generates from the repository's .ico and
// from the two generator sources.
constexpr int kIconId = 1;
constexpr int kNextHtmlId = 100;
constexpr int kOriginalHtmlId = 101;

// Chooser controls, created in code rather than from a dialog resource: four
// controls and a message loop are not worth a .rc template and a DIALOGPROC.
constexpr int kBtnNext = 201;
constexpr int kBtnOriginal = 202;
constexpr int kLblTitle = 203;
constexpr int kLblHint = 204;

enum class App { None, Next, Original };

ComPtr<ICoreWebView2Controller> gController;
// ICoreWebView2_2, not the base interface: add_DOMContentLoaded lives on it.
ComPtr<ICoreWebView2_2> gWebView;
HWND gWindow = nullptr;
App gChoice = App::None;
std::wstring gNextFile;
std::wstring gOriginalFile;
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
 * Unpack one embedded generator and return the full path of the file on disk.
 *
 * The file name carries the fingerprint, so an upgraded build writes a new file
 * rather than overwriting one a running instance is reading, and files from
 * previous builds can be swept without guessing which one is current.
 *
 * `leaf` is the sub-folder; each generator gets its own so a sweep of one can
 * never touch the other.
 */
std::wstring UnpackApp(int resourceId, const wchar_t* leaf) {
  HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(resourceId), RT_RCDATA);
  if (!res) return {};
  const size_t size = SizeofResource(nullptr, res);
  const BYTE* data = static_cast<const BYTE*>(LockResource(LoadResource(nullptr, res)));
  if (!data || !size) return {};

  const std::wstring dir = ProfileDir(leaf);
  const std::wstring want = Fingerprint(data, size);
  const std::wstring path = dir + L"\\generator-" + want + L".html";

  // The file name carries the fingerprint, but a name is a claim, not a check.
  //
  // Testing only that the file exists meant anything that touched those bytes
  // was trusted forever after: a write cut short by a full disk, an antivirus
  // quarantine that restored a truncated copy, a stray edit. The name still
  // matched, so the launcher kept running whatever was there instead of the
  // application it shipped. Measured on this build: an equal-length edit
  // survived a run and the launcher reported itself healthy.
  //
  // Re-hashing 300 KB at start-up costs nothing and turns the name back into
  // the check the comment above it always claimed to be.
  bool rewrite = (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES);
  if (!rewrite) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
      rewrite = true;
    } else {
      const DWORD onDisk = GetFileSize(h, nullptr);
      std::vector<BYTE> buf(onDisk);
      DWORD got = 0;
      const BOOL read = onDisk && ReadFile(h, buf.data(), onDisk, &got, nullptr);
      CloseHandle(h);
      rewrite = !(read && got == onDisk && Fingerprint(buf.data(), onDisk) == want);
    }
  }

  if (rewrite) {
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
  return path;
}

// Which generator is open, and where it lives on disk. The file name is
// fingerprinted, so the URL is built from it rather than guessed: pointing the
// WebView at a name that does not exist produces an error page that looks a lot
// like a broken application.
// Just the file name: this goes into the URL, and a full path in a URL
// normalises down to "/" and lands on an error page that looks like a broken
// application rather than a wrong address.
const std::wstring& ChosenFile() {
  static std::wstring name;
  const std::wstring& full = gChoice == App::Original ? gOriginalFile : gNextFile;
  const size_t slash = full.find_last_of(L'\\');
  name = (slash == std::wstring::npos) ? full : full.substr(slash + 1);
  return name;
}

const std::wstring& ChosenFolder() {
  static const std::wstring app = L"\\app";
  static const std::wstring legacy = L"\\original";
  return gChoice == App::Original ? legacy : app;
}

std::wstring ChosenUrl() {
  std::wstring url = std::wstring(L"https://") + kVhost + L"/" + ChosenFile();
  // The probe is only mounted by the self-test, and only NEXT answers it.
  if (gSelftest) url += L"?probe=1";
  return url;
}

void CloseSoon();
void StartProbe();
void NextPhase();
void Launch(App which);
void OnEnvironmentReady(HRESULT hr, ICoreWebView2Environment* env);

// Self-test phase: 0 is NEXT, 1 is ORIGINAL. The executable carries two
// applications, so the self-test checks both.
int gPhase = 0;

/* ------------------------------------------------------------------ window */

void ResizeWebView() {
  if (!gController) return;
  RECT rc;
  GetClientRect(gWindow, &rc);
  gController->put_Bounds({rc.left, rc.top, rc.right, rc.bottom});
}

// Hide the chooser. The WebView is created on the same window afterwards, so the
// chooser controls have to go or they float on top of the application.
void HideChooser() {
  for (int id : {kBtnNext, kBtnOriginal, kLblTitle, kLblHint}) {
    HWND c = GetDlgItem(gWindow, id);
    if (c) ShowWindow(c, SW_HIDE);
  }
}

HFONT gUiFont = nullptr;
HFONT gUiFontBold = nullptr;

void ShowChooser(HWND hwnd) {
  HINSTANCE inst = reinterpret_cast<HINSTANCE>(GetWindowLongPtrW(hwnd, GWLP_HINSTANCE));

  auto add = [&](const wchar_t* cls, const wchar_t* text, int id, DWORD style,
                  int x, int y, int cw, int ch, HFONT font) -> HWND {
    HWND c = CreateWindowExW(0, cls, text, WS_CHILD | WS_VISIBLE | style,
                             x, y, cw, ch, hwnd,
                             reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), inst, nullptr);
    if (c && font) SendMessageW(c, WM_SETFONT, reinterpret_cast<WPARAM>(font), TRUE);
    return c;
  };

  add(L"STATIC", L"MURTHER FABRIQUE", kLblTitle, 0, 32, 40, 496, 40, gUiFontBold);
  add(L"STATIC",
      L"Two generators live in this repository.\nBoth run entirely offline, from this one file.",
      kLblHint, 0, 32, 86, 496, 48, gUiFont);

  // WS_TABSTOP on the buttons: a control created programmatically is not in the
  // tab ring unless it asks to be, and IsDialogMessage walks exactly the controls
  // that did. The label is decorative text and stays out of the ring.
  add(L"BUTTON", L"Open  NEXT  —  the current generator", kBtnNext, BS_PUSHBUTTON | WS_TABSTOP,
      32, 158, 496, 52, gUiFont);
  add(L"BUTTON", L"Open  ORIGINAL  —  the archived first version", kBtnOriginal, BS_PUSHBUTTON | WS_TABSTOP,
      32, 222, 496, 52, gUiFont);

  SetFocus(GetDlgItem(hwnd, kBtnNext));
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
    case WM_COMMAND:
      if (gChoice == App::None) {
        if (LOWORD(wp) == kBtnNext) { Launch(App::Next); return 0; }
        if (LOWORD(wp) == kBtnOriginal) { Launch(App::Original); return 0; }
      }
      break;
    case WM_CLOSE:
      if (gController) gController->Close();
      DestroyWindow(hwnd);
      return 0;
    case kSelftestMsg:
      StartProbe();
      return 0;
    case WM_DESTROY:
      if (gUiFont) DeleteObject(gUiFont);
      if (gUiFontBold) DeleteObject(gUiFontBold);
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

/* ---------------------------------------------------------------- self-test */

// Both probes are generic: they measure the document, not a particular
// application. window.wgn only exists on NEXT and only with ?probe=1, so the
// NEXT-specific assertions are conditional and the rest applies to whichever
// generator is open. That is what lets one self-test cover both.
//
// The viewport check is load-bearing. A 0x0 controller still loads the page and
// still runs every script, so the original version of this self-test passed on a
// window that showed the user nothing but black.
// Installed before any page script runs, which is the only moment at which a
// failure during the page's own start-up can still be caught. `rendered` below
// cannot see those failures on its own: a page whose script threw on its first
// line still has a title, still has a script element, and still shows whatever
// static markup the document shipped with. It looks painted and it is dead.
//
// ORIGINAL has no window.wgn, so the deep check below is skipped for it. That
// left the legacy generator verified only down to "a page appeared", which is
// the one thing a self-test should never accept as proof of life.
//
// Only uncaught exceptions and unhandled rejections are recorded. A resource
// that fails to load fires an error event on the element itself and still
// reaches a capturing listener on window; a page may legitimately reference
// something optional, but it may not throw while starting up.
constexpr wchar_t kErrorHook[] =
    L"(function(){var e=[];window.__mfErrors=e;"
    L"window.addEventListener('error',function(v){if(v.target===window)"
    L"e.push(String(v.message||(v.error&&v.error.message)||'error'));},true);"
    L"window.addEventListener('unhandledrejection',function(v){"
    L"var r=v&&v.reason;e.push('unhandled rejection: '+String((r&&r.message)||r));"
    L"},true);})()";

constexpr wchar_t kProbe[] =
    L"(function(){var o={};try{"
    L"o.ready=!!window.wgn;"
    L"o.files=window.wgn?Object.keys(window.wgn.build().files).length:-1;"
    L"o.selfCheck=window.wgn?window.wgn.errors().length:-1;"
    L"o.errors=Array.isArray(window.__mfErrors)?window.__mfErrors.slice(0,3):'no hook';"
    L"o.storage=(function(){try{localStorage.setItem('__mf','1');var v=localStorage.getItem('__mf')==='1';localStorage.removeItem('__mf');return v;}catch(e){return false;}})();"
    L"o.origin=location.origin;o.path=location.pathname;o.title=document.title;"
    L"o.viewport=innerWidth+'x'+innerHeight;"
    L"o.scripts=document.scripts.length;"
    L"o.text=(document.body?document.body.innerText:'').length;"
    L"}catch(e){o.error=e.message}"
    L"return JSON.stringify(o)})()";

// The verdict recomputes everything instead of reading what the probe left
// behind. Two scripts submitted back to back are not ordered against each
// other, so a verdict that depended on a value the probe had not written yet
// would report a failure that is really a race.
constexpr wchar_t kVerdict[] =
    L"(function(){try{"
    L"var store=(function(){try{localStorage.setItem('__mf','1');var v=localStorage.getItem('__mf')==='1';localStorage.removeItem('__mf');return v;}catch(e){return false}})();"
    L"var rendered=innerWidth>=640&&innerHeight>=400&&document.title.length>0"
    L"&&document.scripts.length>0&&document.body&&document.body.innerText.length>10;"
    L"var deep=!window.wgn||(Object.keys(window.wgn.build().files).length>10&&window.wgn.errors().length===0);"
    // -1 rather than a default of 0 when the hook is absent: a missing hook has
    // to fail the verdict. Treating it as "zero errors" would make the one check
    // that covers ORIGINAL pass precisely when it is not running at all.
    L"var errs=Array.isArray(window.__mfErrors)?window.__mfErrors.length:-1;"
    L"return (rendered&&deep&&store&&errs===0)?0:1;"
    L"}catch(e){return 2}})()";

void CloseSoon() { PostMessage(gWindow, WM_CLOSE, 0, 0); }

// ExecuteScript answers through the message loop, not through the call. So the
// self-test posts a message, runs the probe from there, and lets the normal loop
// carry both answers back. Pumping re-entrantly from inside DOMContentLoaded is
// what made the first version return nothing at all.
std::wstring gProbeJson;
std::wstring gVerdictJson;

// The self-test walks both generators: NEXT first, then the same window is
// navigated to ORIGINAL and probed again. One executable carries two
// applications; checking one of them is half a check.
void StartProbe() {
  gProbeJson.clear();
  gVerdictJson.clear();

  const wchar_t* which = gChoice == App::Original ? L"ORIGINAL" : L"NEXT";
  Say((std::wstring(L"MURTHER FABRIQUE -- probing ") + which).c_str());

  const HRESULT probeHr = gWebView->ExecuteScript(
      kProbe, Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                  [](HRESULT, LPCWSTR json) -> HRESULT {
                    if (json) gProbeJson = json;
                    return S_OK;
                  }).Get());

  const HRESULT verdictHr = gWebView->ExecuteScript(
      kVerdict, Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                    [which](HRESULT code, LPCWSTR json) -> HRESULT {
                      if (json) gVerdictJson = json;
                      Say((std::wstring(L"  ") + which + L"  ").c_str());
                      Say(gProbeJson.empty() ? L"(the page returned nothing)" : gProbeJson.c_str());
                      Say((std::wstring(L"  verdict ") + which + L": ").c_str());
                      Say(gVerdictJson.empty() ? L"(none)" : gVerdictJson.c_str());
                      const bool ok = SUCCEEDED(code) && gVerdictJson == L"0";
                      if (!ok) {
                        gExit = 1;
                        CloseSoon();
                      } else if (gPhase == 0) {
                        NextPhase();
                      } else {
                        // The page cannot see the window it sits in. Every other
                        // check here is measured inside the WebView, so a window
                        // that was created and never shown, or shown with no
                        // client area, still reports a perfectly healthy page --
                        // which is the exact failure the resize comment above
                        // describes. On a real machine this line is the evidence.
                        RECT rc = {};
                        IsWindowVisible(gWindow);
                        GetClientRect(gWindow, &rc);
                        const int cw = rc.right - rc.left;
                        const int ch = rc.bottom - rc.top;
                        wchar_t note[160];
                        swprintf_s(note, L"  native window: client %d x %d", cw, ch);
                        Say(note);
                        if (cw < 320 || ch < 240) {
                          Say(L"MURTHER FABRIQUE FAILED: the native window has no usable size.");
                          gExit = 5;
                          CloseSoon();
                          return S_OK;
                        }
                        gExit = 0;
                        Say(L"MURTHER FABRIQUE -- both generators OK");
                        CloseSoon();
                      }
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
  PostMessage(gWindow, kSelftestMsg, 0, 0);
}

int Fail(const wchar_t* what) {
  Say(L"MURTHER FABRIQUE FAILED:");
  Say(what);
  // A Windows machine with no WebView2 Runtime is real: Windows 10 LTSC and
  // Server images ship without Edge. Erroring out would leave that user with
  // nothing at all, when the application is a single HTML file that any browser
  // on the machine can already open. So the fallback is not a courtesy, it is
  // the whole difference between "does not run" and "runs with a browser
  // window instead of a native one".
  const std::wstring app = ChosenFolder() == L"\\original" ? gOriginalFile : gNextFile;
  if (!app.empty()) {
    Say(L"Falling back to the default browser for this session.");
    const std::wstring fileUrl = L"file:///" + [&] {
      std::wstring s = app;
      for (wchar_t& c : s) if (c == L'\\') c = L'/';
      return s;
    }();
    if (reinterpret_cast<intptr_t>(ShellExecuteW(nullptr, L"open", fileUrl.c_str(),
                                                nullptr, nullptr, SW_SHOWNORMAL)) > 32) {
      Say(L"Opened. The application is unchanged; only the window is a browser tab.");
      return 0;
    }
  }

  Say(L"It needs the Microsoft Edge WebView2 Runtime (Evergreen), which ships");
  Say(L"with Windows 11 and Windows 10 21H2 and later. Get it from");
  Say(L"https://developer.microsoft.com/microsoft-edge/webview2/");
  if (gLogToFile) return 2;
  MessageBoxW(nullptr, what, kTitle, MB_OK | MB_ICONERROR);
  return 2;
}

/* --------------------------------------------------------------- start-up */

void ConfigureWebView(ICoreWebView2_2* webview) {
  // Unconditionally, and not only for the self-test: the hook is a few hundred
  // bytes and it is the one thing that tells a painted page from a live one.
  // Mounted once per controller, it survives the self-test's second navigation.
  webview->AddScriptToExecuteOnDocumentCreated(
      kErrorHook,
      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
          [](HRESULT, LPCWSTR) -> HRESULT { return S_OK; }).Get());

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
              // gSelftest stays true: the self-test navigates from one
              // generator to the other and needs this handler again.
              if (gSelftest) PostMessage(gWindow, kSelftestMsg, 0, 0);
              return S_OK;
            }).Get(),
        nullptr);
  }
}

void OnControllerReady(HRESULT hr, ICoreWebView2Controller* controller) {
  // A missing runtime is not fatal: Fail() falls back to the default browser.
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

  // Serve the chosen generator as https://murther-fabrique.local/, which is what
  // gives the page a real origin and therefore a working localStorage.
  // DENY_CORS: neither application makes a cross-origin request and neither
  // should be able to. It is the tighter of the two modes and costs nothing here.
  ComPtr<ICoreWebView2_3> webview3;
  if (FAILED(gWebView.As(&webview3)) ||
      FAILED(webview3->SetVirtualHostNameToFolderMapping(
          kVhost, ProfileDir(ChosenFolder().c_str()).c_str(),
          COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
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

  const std::wstring url = ChosenUrl();
  gWebView->Navigate(url.c_str());
}

/**
 * Open one of the two generators.
 *
 * The WebView is created on the same window the chooser used, once, when the
 * user has chosen — not at startup for both. Two controllers on one window
 * would fight over the same pixels, and the second one to be created is the one
 * the user cannot see.
 */
void Launch(App which) {
  if (gChoice != App::None) return;  // one choice per launch
  gChoice = which;
  HideChooser();

  if (ChosenFile().empty()) {
    Fail(which == App::Original ? L"The original generator is missing from this build."
                                : L"The NEXT generator is missing from this build.");
    CloseSoon();
    return;
  }

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
}

/**
 * Self-test phase two: same window, other generator.
 *
 * Re-pointing the virtual host at the other folder is the whole trick -- one
 * controller serves both applications, so switching is a remap and a navigate,
 * not a second WebView.
 */
void NextPhase() {
  gPhase = 1;
  gChoice = App::Original;
  if (gOriginalFile.empty()) {
    Say(L"MURTHER FABRIQUE FAILED: the original generator is missing from this build.");
    gExit = 2;
    CloseSoon();
    return;
  }
  ComPtr<ICoreWebView2_3> webview3;
  if (FAILED(gWebView.As(&webview3)) ||
      FAILED(webview3->SetVirtualHostNameToFolderMapping(
          kVhost, ProfileDir(ChosenFolder().c_str()).c_str(),
          COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
    Say(L"MURTHER FABRIQUE FAILED: the original generator could not be remapped.");
    gExit = 4;
    CloseSoon();
    return;
  }
  gWebView->Navigate(ChosenUrl().c_str());
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
  bool wantOriginal = false;
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--selftest") == 0) { gSelftest = true; gLogToFile = true; }
    if (wcscmp(argv[i], L"--original") == 0) wantOriginal = true;
  }
  if (argv) LocalFree(argv);

  // Both generators come out before anything else: a launcher that can only open
  // one of the two it carries is worse than one that carries one.
  gNextFile = UnpackApp(kNextHtmlId, L"\\app");
  gOriginalFile = UnpackApp(kOriginalHtmlId, L"\\original");
  if (gLogToFile) {
    Say((ProfileDir(L"\\app") + L"  <- NEXT").c_str());
    Say((ProfileDir(L"\\original") + L"  <- ORIGINAL").c_str());
  }
  if (gNextFile.empty()) return Fail(L"The NEXT generator is missing from this build.");

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

  gUiFont = CreateFontW(-16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                        DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
  gUiFontBold = CreateFontW(-20, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                            DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");

  // A double-click shows the chooser; --original and --selftest do not, because
  // they are already a decision. Both generators have to be unpacked either way.
  if (wantOriginal || gSelftest) {
    Launch(wantOriginal ? App::Original : App::Next);
  } else {
    ShowChooser(gWindow);
  }

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
    // Tab between the two chooser buttons, and Enter on the focused one, are
    // both implemented by the dialog manager rather than by DefWindowProc. A
    // plain GetMessage/Translate/Dispatch loop never calls it, so focus lands on
    // the first button at start-up and stays there: the second generator could
    // not be reached from the keyboard at all.
    //
    // Only while the chooser is up. The same window hosts the WebView once a
    // generator is chosen, and IsDialogMessage swallows VK_UP, VK_DOWN and F5
    // whether or not any control uses them -- running it over the live page
    // would break the editor's own keyboard handling.
    if (gChoice == App::None && IsDialogMessageW(gWindow, &msg)) continue;
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  CoUninitialize();
  return gExit;
}
