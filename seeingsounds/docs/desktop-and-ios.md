# Desktop and iOS app

Seeing Sounds is packaged with [Tauri 2](https://v2.tauri.app). Tauri shows the
same React front end in the operating system's own web view (WKWebView on macOS
and iOS, WebView2 on Windows, WebKitGTK on Linux) and wraps it in a small native
app. The audio math engine runs in a Web Worker inside the app, so the app works
offline and needs no server.

The Tauri project lives in [`src-tauri/`](../src-tauri/).

## Tools to install

Every platform needs:

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs), installed with `rustup`

Then, per platform:

| Platform | Also install |
|---|---|
| macOS (desktop) | Xcode from the Mac App Store. Open it once to accept the license. |
| iOS | A Mac with the full Xcode app, [CocoaPods](https://cocoapods.org) (`brew install cocoapods`), and the iOS Rust targets below. A free Apple ID is enough to run the app on your own iPhone (it must be reinstalled every 7 days). A paid Apple Developer account is needed for TestFlight and the App Store. |
| Windows | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++". WebView2 ships with Windows 11. |
| Linux (Debian/Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` |

iOS Rust targets:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

iOS apps can only be built on a Mac. Each desktop installer is built on its own
operating system.

## Desktop

Install the JavaScript dependencies once:

```bash
npm install
```

Run the app in development, with hot reload:

```bash
npm run tauri dev
```

Build an installer:

```bash
npm run tauri build
```

The result is in `src-tauri/target/release/bundle/`: a `.dmg` and `.app` on
macOS, `.msi` and `.exe` on Windows, `.deb`, `.rpm` and `.AppImage` on Linux.

## iOS

Generate the Xcode project once. This creates `src-tauri/gen/apple/`, which you
should commit:

```bash
npm run tauri ios init
```

Run in the iOS Simulator, or on an iPhone connected by cable:

```bash
npm run tauri ios dev
```

To use a physical iPhone, open `src-tauri/gen/apple/*.xcodeproj` in Xcode once,
pick your team under Signing & Capabilities, and keep the phone on the same
Wi-Fi network as the Mac. The dev server listens on the address Tauri passes in
`TAURI_DEV_HOST` (see `vite.config.ts`).

Build for TestFlight or the App Store:

```bash
npm run tauri ios build
```

Then upload the archive from Xcode (Window > Organizer) or with Transporter.

## Before you publish

- **Bundle identifier.** `identifier` in `src-tauri/tauri.conf.json` is
  `com.yeahmel.seeingsounds`, on YEAHMEL INC LLC's yeahmel.com domain. Register
  the same identifier in your Apple Developer account. It cannot be changed
  after the first App Store release.
- **Icons.** The app icon is the drip "SS" from the Seeing Sounds logo. Its
  1024x1024 source is `app-icon.png` at the repository root, and
  `src-tauri/icons/` holds the sizes made from it. After `tauri ios init`, or
  after changing `app-icon.png`, regenerate them so Xcode gets the iOS set too:
  `npm run tauri icon -- --ios-color "#0e0d0b"`. The colour fills the
  transparent corners, because iOS icons must be opaque.
- **Code signing.** macOS builds need a Developer ID certificate and
  notarization to open without warnings on other Macs. Windows builds should be
  signed to avoid SmartScreen warnings. See Tauri's
  [distribution guides](https://v2.tauri.app/distribute/).

## How the pieces fit

| Piece | Where | Used by |
|---|---|---|
| React front end | `src/` | Web, desktop, iOS |
| Math and visual engines (TypeScript) | `src/engine/` | On the device, through `analysisWorker.ts`: desktop, iOS, and the web when offline |
| Math and visual engines (Python) | `math_engine.py`, `visual_engine.py`, `api/` | The Cloud Run web server; see [cloud-run.md](cloud-run.md) |
| Visualizer and video export | `src/visualizer/` | Web, desktop, iOS |
| Sample track generator | `src/engine/sampleTrack.ts` | The app's "Try the sample track" button and `/api/sample-track` |
| Native shell | `src-tauri/` | Desktop and iOS |
| Node server | `server.ts` | `npm run dev` and the HTTP API only; not shipped in the apps |
| ZEAL cover visualizer | `visualizer/` | Separate command-line tool; not part of the apps |
