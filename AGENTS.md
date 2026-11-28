# Working on Syntax

Syntax is an open-source, extensible browser-based learning platform.

## Repository Boundaries

- **`syntax-platform/syntax` (this repo)**: Core web application shell, routing, Clerk auth and cloud sync, Sema companion (`src/mascot/`), preferences, and the Extensions v1 runtime (`src/extensions/`).
- **`syntax-platform/syntax-official-extensions`**: First-party courses, interactive engines, and workspace tools (Analytic Geometry, Thinking in Code, Pen Studio, Video Walkthroughs / Manim pipeline, Formula Playbook). Do not hardcode courses or extensions back into core `syntax`.
- **`syntax-platform/syntax-community`**: Community catalog and discovery site.
- **`syntax-platform/syntax-dev`**: Nightly pre-release deployment target and pre-release tags.

## Core Architecture

The [extensions master plan](docs/extensions/MASTER-PLAN.md) tracks the new runtime and its milestone checks. The [current architecture](docs/extensions/ARCHITECTURE.md) describes the worker and iframe runtime still on Stable.

- `src/shell/` (`AppShell.tsx`, `AppHeader.tsx`): Hash routing (`wouter`), top navigation, light/dark mode and sound management, and dev inspector loading.
- `src/core/`: Clerk auth and cloud sync (`clerkAuth.tsx`, `clerkSync.ts`, `cloudSchema.ts`, `account.ts`), preferences (`prefs.ts`), error boundaries, logging, and dev environment utilities.
- `src/extensions/`: PlugOS-adapted Extensions v1 runtime (`plugos/workerSandbox.ts`, `manifest.ts`, `contributions.ts`, `services.ts`, `documents.ts`, `diagnostics.ts`, `store.ts`, `manager.ts`, `ExtensionViewFrame.tsx`, `ExtensionPage.tsx`, `catalog.ts`).
- `public/sdk/syntax-view-v1.js`: Zero-dependency View SDK for sandboxed extension iframes.
- `src/mascot/`: Core Sema companion (`Sema.tsx`, `TopBarSema.tsx`, `bloub/`).
- `src/ui/`: Core platform pages (`HomePage.tsx`, `LibraryPage.tsx`, `ExtensionsPage.tsx`, `ExtensionInstallModal.tsx`, `ExtensionIcon.tsx`, `CommunityHubPage.tsx`, `ProfilePage.tsx`, `ProfilePopover.tsx`, `SettingsPage.tsx`, `OnboardingModal.tsx`, `AccountModal.tsx`).

## Commands

- `npm run dev`: Start Vite dev server on port 5189.
- `npm run build`: Run `tsc -b && vite build` (must pass with 0 errors before committing).
- `npm run preview`: Preview the production bundle locally.
