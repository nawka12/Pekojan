// Electron shell for the Pekojan desktop builds.
//
// The renderer is the unmodified Vite bundle from dist/. It is served over a
// custom `app://` scheme instead of `file://` so the page gets a real secure
// origin — ES modules load and localStorage (settings/stats persistence) works
// exactly as it does on the web.

const { app, BrowserWindow, Menu, protocol, net, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST = path.join(__dirname, "..", "dist");
const ORIGIN = "app://pekojan";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serve(request) {
  const { pathname } = new URL(request.url);
  const decoded = decodeURIComponent(pathname);
  const target = path.join(DIST, decoded);
  // Never serve outside dist/, and fall back to the SPA entry point.
  const safe = target.startsWith(DIST + path.sep) ? target : path.join(DIST, "index.html");
  return net.fetch(pathToFileURL(safe).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 640,
    backgroundColor: "#0b0d13",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);

  // The game has no outbound links, but keep any stray one out of the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle("app", serve);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
