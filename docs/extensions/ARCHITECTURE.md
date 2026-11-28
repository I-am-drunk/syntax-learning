# Syntax Extensions v1 Architecture

For the next runtime and its release milestones, see the [Syntax extensions master plan](MASTER-PLAN.md).

General-purpose, browser-native extension architecture for Syntax built on SilverBullet's MIT-licensed PlugOS worker isolation model.

## Design Principles

1. **YAGNI.** Every module owns one concrete responsibility. No speculative hooks, event buses, custom compilers, or theme-extension overload.
2. **Author freedom, host ownership.** An extension owns its logic (`worker.js`) and custom UI (`view/index.html`). Syntax owns where contributions appear, user-saved documents, and guaranteed cleanup on disable/unload.
3. **Zero author build tool required.** A friend can write plain ES modules (`export function myCmd(ctx) {}`) and plain HTML/JS/CSS hosted on any CORS-enabled static server (or bundled with Vite/esbuild).
4. **Real fault isolation.** Background code runs in per-extension Web Workers (`WorkerSandbox`). Visual UI runs in opaque-origin sandboxed iframes (`sandbox="allow-scripts allow-forms"`, strictly no `allow-same-origin`).
5. **General-purpose first.** Supports standalone tools (`page`/`tab`), embeddable extensions (`embed`), command-only tools, and collaborating extensions via versioned services. Courses are simply one future consumer among many.

## V1 to V20 Simplification Summary

- **Removed custom compiler & archive VFS (V2):** Static URL + `extension.json` first; future archive format reuses the exact same `WorkerSandbox` Blob loader.
- **Deferred theme extensions (V3):** Core light/dark appearance stays in Settings; views receive read-only theme tokens.
- **Replaced PlugOS abstract `Hook<T>` & `EventBus` (V4, V5):** One typed Zustand `ContributionStore` (`commands`, `toolbar`, `views`) + explicit versioned `ServiceRegistry`.
- **Zero-dependency semver (V6):** 40-line pure TS `satisfiesSemver()` instead of adding external runtime packages.
- **Merged `Plug` + `WorkerSandbox` (V7) & Two-Blob dynamic `import()` bootstrap (V8):** Solves cross-origin `new Worker()` `SecurityError`, catches author `SyntaxError` in <50ms, maps stack traces via `//# sourceURL=`, and needs zero author SDK imports.
- **Direct `<iframe src>` with opaque origin (V9, V10):** Native relative asset loading, strict `event.source` + `event.origin === 'null'` + `(instanceId, activationId)` validation, double-`onload` navigation guard, zero `srcdoc` HTML rewriting bugs.
- **Staged atomic activation & updates (V16, V19):** Candidate workers boot and validate before replacing active state or committing UI contributions. Failed startup or bad update leaves zero debris.
- **User-owned IndexedDB `DocumentStore` (V14, V15):** Small `ExtensionRecord` metadata in `localStorage` for instant Safe Mode (`#/?safeMode=1`); user documents in IndexedDB with optimistic `revision` conflict checks that survive disable/uninstall/reinstall.

## Repository Hierarchy

```text
src/extensions/
  plugos/
    LICENSE.md           # SilverBullet MIT license (Copyright 2022, Zef Hemel)
    UPSTREAM.md          # Upstream commit 53452e220a9b4e5643fb2b9a7ca2151be51b3ab3 & diffs
    protocol.ts          # Worker & view RPC message types + ExtensionError
    workerSandbox.ts     # Two-Blob PlugOS WorkerSandbox (timeout, stop+reject, log forwarding)
  manifest.ts            # Zod v4 schema for extension.json, URL resolution, timed fetch, semver
  contributions.ts       # Per-extension owned Zustand ContributionStore (atomic commit/cleanup)
  services.ts            # Versioned ServiceRegistry (requires/optional, cycle & version checks)
  documents.ts           # User-owned IndexedDB DocumentStore (envelope + revision check)
  diagnostics.ts         # Bounded per-extension ring buffer, syntaxLog bridge, bug report, leak counters
  store.ts               # localStorage ExtensionRecord persistence, runtime status, isSafeMode()
  manager.ts             # Serialized lifecycle orchestrator + window.__SYNTAX_EXTENSIONS__ test hook
  ExtensionViewFrame.tsx # Opaque-origin sandboxed iframe host with instanceId/activationId retirement
  ExtensionPage.tsx      # Thin route wrapper (#/ext/:extensionId/:viewId/:docId?) with recovery UI
  catalog.ts             # Honest remote catalog fetcher (idle/loading/ready/error)
```

## Extension Authoring Rules (Cross-Origin Contract)

1. Host `extension.json`, `worker.js`, and any `view/*` files with `Access-Control-Allow-Origin: *` (required for both cross-origin worker fetch and `<script type="module">` inside opaque-origin sandboxed iframes).
2. Keep `worker.js` self-contained (or use absolute CORS URLs for imports; relative `./helper.js` ES imports are unsupported inside Blob Workers). Use `ctx.extension.assetUrl('./file.json')` for relative data fetches.
3. Custom views cannot access `window.localStorage` or `window.parent.document`; persist state through `syntax:view-call` RPC to the extension worker or host `DocumentStore`.

## Quick Start: Writing an Extension

Host three static files on any server that sends `Access-Control-Allow-Origin: *`:

### 1. `extension.json`

```json
{
  "formatVersion": 1,
  "id": "you.notes",
  "name": "Quick Notes",
  "version": "1.0.0",
  "worker": "./worker.js",
  "views": [
    { "id": "main", "title": "Notes", "entry": "./view/index.html", "placement": "page", "docTypes": ["note"] },
    { "id": "widget", "title": "Scratchpad", "entry": "./view/embed.html", "placement": "embed" }
  ],
  "commands": [
    { "id": "new-note", "title": "New Note", "run": "createNote" }
  ],
  "toolbar": [
    { "id": "open-notes", "label": "Notes", "viewId": "main" }
  ],
  "settings": [
    { "id": "defaultTitle", "type": "string", "label": "Default title", "default": "Untitled Note" }
  ]
}
```

### 2. `worker.js`

```js
export async function onActivate(ctx) {
  ctx.log.info('Quick Notes ready', await ctx.settings.get('defaultTitle'))
}

export async function createNote(ctx, body = '') {
  const title = await ctx.settings.get('defaultTitle')
  return await ctx.documents.create({ type: 'note', title, data: { body } })
}
```

### 3. `view/index.html` (Zero-Boilerplate View SDK)

Use the official zero-dependency SDK (`public/sdk/syntax-view-v1.js`) to connect to Syntax, sync Light/Dark theme tokens automatically, auto-resize embedded widgets, and call your worker or Syntax documents:

```html
<!doctype html>
<html>
<body>
  <script type="module">
    import { connectSyntaxView } from 'https://syntax-platform.github.io/syntax/sdk/syntax-view-v1.js'

    const view = await connectSyntaxView({
      autoResize: true,
      onSettings(settings) {
        console.log('Live settings:', settings)
      },
    })

    const docs = await view.documents.list()
    const created = await view.callWorker('createNote', 'Hello Syntax')
    await view.ui.notify(`Created ${created.title}`, 'success')
  </script>
</body>
</html>
```

Workers can also export `export function onSettingsChanged(ctx, settings) {}` to react immediately whenever the user edits settings on the Extensions page.

### Security & Ownership Guarantees

- **Per-extension document isolation:** Extensions can only list, read, and save documents they created (`createdByExtensionId`). Cross-extension collaboration goes explicitly through versioned `services`.
- **Per-extension quotas:** Documents are capped at 2 MB each and 250 documents per extension.
- **Pre-install review:** Installing from a URL or Community Hub validates `extension.json` first and displays host origin and declared capabilities before executing any code.

## Planned Improvements

- **Automatic Safe Mode on true startup failure:** Currently Safe Mode is entered explicitly via `?safeMode=1` (or `#/?safeMode=1`). A planned reliability safeguard is a lightweight boot-sentinel check (for example, marking a boot-in-progress flag in `sessionStorage` / `localStorage` before extension startup and clearing it once the app shell and extension boot finish cleanly). If startup truly crashes or repeatedly fails to settle on consecutive loads, Syntax should automatically restart into Safe Mode so the user is never trapped in a broken boot loop, while explaining why Safe Mode was triggered and offering a one-click Exit Safe Mode action.
