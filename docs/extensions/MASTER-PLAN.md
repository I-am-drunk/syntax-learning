# Syntax extensions master plan

Syntax will rebuild the extension system in tested increments. First prove the raw runtime, release safety, and authoring tools with small test packages. Use Quick Notes as the first real tool once that foundation holds. V2 is the release that proves the complete system works together.

The V1.0 through V1.5 numbers are planning labels. The existing runtime stays on Stable during the transition. The new runtime goes to Syntax Dev in increments. Students get a Beta build only after the candidate passes its release checks.

- [How to start](#how-to-start)
- [Risks to resolve before rollout](#risks-to-resolve-before-rollout)
- [Milestones and release gates](#milestones-and-release-gates)
- [Release channels](#release-channels)
- [Documentation and the generated wiki](#documentation-and-the-generated-wiki)
- [Feedback index](#feedback-index)
- [V2.5 and later](#v25-and-later)

## How to start

1. **Establish the baseline.** Check the current branch, [deployment PR](https://github.com/syntax-platform/syntax/pull/40), the builds actually serving Dev and Stable, the current extension tests, and what the release jobs can publish. Record the tested commit and baseline results. Check which older feedback still reproduces.
2. **Make the first change small.** Protect Stable from promotion of Dev-only commits. Map browser storage, reset behavior, and Clerk sync across channels before replacing the runtime. Keep the current extension tests as a baseline. Decide which tests carry over by checking the behavior each one proves.
3. **Prove the plumbing.** Agree on the smallest manifest, host API, and build contract that a standalone tool needs. Test it with small external packages that succeed or fail on purpose. Review the first implementation and the authoring walkthrough independently. Fix the findings and repeat the checks. Start Quick Notes after the foundation passes.

Treat each milestone as several rounds of work. Build a small part, test what it actually does, get an independent review where the milestone calls for it, fix defects, and check the exact candidate again. Keep fixes in the current milestone until the release gate passes. Use the [V2 goal prompt](V2-GOAL.md) to carry the work across sessions.

## Risks to resolve before rollout

- **Stable can select the wrong build.** The existing default-branch workflow promotes the latest Nightly. The foundation branch replaces that behavior with an explicitly approved commit on a manual dispatch. GitHub Pages now accepts deployments from `main` only. Land and verify the workflow change before a new-runtime build goes to Dev. [Stable release selection](../../.github/workflows/release.yml#L150)
- **Dev can affect Stable data.** Their GitHub Pages paths share a browser origin. Dev's current reset clears browser storage and attempts to delete databases. Inventory install records, course data, reset and recovery flags, and Clerk sync. Give the new runtime its own state and verify that clearing it preserves seeded Stable data. [Dev reset](../../src/core/devEnv.ts#L67) · [Clerk sync](../../src/core/clerkSync.ts)
- **Beta can publish a build that was never accepted.** The foundation branch requires an explicit candidate through `SYNTAX_BETA_APPROVED_SHA`. The artifact, deployed commit marker, and release tag refer to that commit. Rehearse empty and ineligible candidates, repeat runs, and a failure after upload. Keep Beta disabled for students until the rehearsal passes. [Beta candidate selection](../../.github/workflows/beta-release.yml#L17)
- **A workflow can pass without deploying.** The draft infrastructure PR passed its build and test check while its Infra jobs skipped. Treat skipped jobs as missing deployment evidence. For each live channel, confirm the served commit and rehearse restoring a known working build. Cloudflare access and the first live Infra and Beta runs remain pending. [Infrastructure draft PR](https://github.com/syntax-platform/syntax/pull/40)
- **An install error may look like success.** The earlier course installed without a usable Library entry. Make install, activation, and availability distinct states. Report success with **Open** only after the extension registers its screen. Show why a failure happened and whether an existing version is still active.
- **The existing runtime proves different failure behavior.** The worker-based test can stop a stuck worker. The new native runtime must prove its own error handling and recovery after an interrupted startup. Keep the old suite for Stable and use a real browser for new checks. [Current extension tests](../../tests/e2e/extensions.test.mjs)

## Milestones and release gates

For each milestone, record its status, PRs, exact tested commit, relevant deployment links, test commands and results, review findings and fixes, and open feedback. Link to the evidence in the section for that milestone. A PR can merge into `main` before the milestone closes. Only start the next milestone once this one passes. Rerun affected checks after fixes and again on the final candidate. A passing local build or a single working example can be part of that evidence. Closing a milestone requires all of its checks.

| Milestone | What you can use | Status |
| --- | --- | --- |
| [V1.0](#v10-runtime-and-authoring-foundation) | A tested runtime and a documented way to build and install an external test package | Planned |
| [V1.1](#v11-quick-notes-and-authoring-proof) | An independently authored notes tool with a screen, a command, and recovery | Planned |
| [V1.2](#v12-course-ui-and-progress) | A real lesson and shared learning UI | Planned |
| [V1.3](#v13-embedded-extensions-tools-and-themes) | A course with required embedded behavior and an optional tool | Planned |
| [V1.4](#v14-publishing-discovery-and-docs) | A documented authoring, publishing, and install path | Planned |
| [V1.5](#v15-release-rehearsal) | A complete release rehearsal on the actual sites | Planned |
| [V2](#v2-release-gate) | The complete system after every gate passes | Planned |

### V1.0 Runtime and authoring foundation

Prototype the smallest native React runtime for trusted extensions. Start with a strict manifest, a declared host compatibility range, an extension-owned screen and command, local storage, and cleanup on disable. Reuse routing, the command palette, error boundaries, and Sonner where they fit. Keep Sema in core. The test packages are fixtures with small, predictable behavior.

Write down the manifest and the public calls before adding features. Use one shared validation contract for the host and author checks and derive publishable types and schema from it where practical. Give an author TypeScript types, a small build setup with locked dependencies, and a short walkthrough to build, validate, host, and install a fixture from a URL. Make validation errors explain what to change and retain a stable error identifier for future agent tools. Use versioned artifacts and keep test hosting simple. The manifest format, supported host API, and V1 delivery milestone each have their own purpose. Interactive local preview in Syntax remains V2.5.

Measure the authoring experience with a fresh checkout. Record setup steps, time to the first working install, the error a beginner sees, and what they had to ask. Fix concrete friction in the build, check, or docs. Add tooling when the walkthrough shows a repeatable need. The future MCP should be able to use the same commands, schema, and examples.

Keep the artifact and its source identity with the installed record. Validate the candidate before replacing a working version. Commit its contributions only after activation succeeds. On failure, remove registrations from that attempt, ignore late results, and preserve the previous working artifact and data. A native extension shares the app's browser thread. Catch failures at host-controlled boundaries. Use a startup marker and a recovery launch without the suspect code after a hard freeze forces a reload.

**Release gate**

- [ ] Verify that a Dev-only commit cannot reach Stable by manual promotion or a tag push. In one browser profile and a test account, prove installs, storage, sync, and reset in Dev leave Stable data intact. Keep Dev extension sync off until it passes against isolated state if necessary.
- [ ] Verify the manual Dev and Nightly release paths with a commit marker and a known-good rollback. Exercise the Infra and Beta eligibility and artifact checks before account setup. Keep live Infra and student Beta verification open until their separate rehearsal.
- [ ] Install a valid external fixture into a clean browser and use its screen and command. Reject malformed manifests, incompatible host versions, duplicate identities, and missing assets with actionable errors. Exercise an unavailable host and a failed replacement. The installed working version and saved data remain usable.
- [ ] Simulate failures in loading, rendering, and commands. Confirm a healthy sibling still works, and that repeated enable, disable, and restart cycles leave one copy of each contribution. Check recovery on reload after interrupted startup. If responsibility is unclear, launch without extensions and explain why.
- [ ] Reproduce the documented author flow from a fresh external checkout on Windows and in CI. Use the same inputs and commands authors will get. Build twice and verify matching manifest, declared assets, and behavior. Record the steps that were confusing or failed, fix the tooling or instructions, and repeat the walkthrough.
- [ ] Get independent reviews of runtime behavior, authoring, and release isolation. Resolve blocking findings, rerun the tests, and exercise the applicable checks on the exact Dev build before starting Quick Notes.

**Foundation evidence so far**

- [Draft PR #40](https://github.com/syntax-platform/syntax/pull/40) is the release workflow branch. Baseline `ef91f3e` passed [CI](https://github.com/syntax-platform/syntax/actions/runs/46119202194). Infra skipped. Both public sites returned HTTP 200. The latest permitted Pages rule for Stable allows the `main` branch. No Stable release was triggered for this work.
- The foundation branch passed the production build, 29 unit tests, and six Chromium scenarios. The new browser scenario installs on Stable and Dev in one browser context, then checks that the Dev reset leaves the Stable install, storage, and database intact. Workflow lint passed. An independent review led to checking the Stable tag again immediately before publication, seeding a real Stable install in the browser test, and giving draft previews their own state.
- V1.0 remains open. The workflow changes need merged CI evidence and a live Dev rehearsal. The scoped state is local-only in Dev, Beta, and previews until cloud state isolation is proven. Unprefixed legacy state stays with Stable. It is not copied into Dev. The raw native contract and independent author walkthrough still need their own evidence.

### V1.1 Quick Notes and authoring proof

Build Quick Notes outside the host with the same public API, types, and build checks used in the foundation. It has one plain-text scratchpad with autosave, one screen, and one command to open it. After installation, Syntax offers **Open**. The installed tool has one clear home in Extensions, including when disabled.

If an extension crashes, keep it visible in Extensions with **Inspect** and **Re-enable**. Show a top-right desktop notification for the initial failure. If the user retries the same build and nothing relevant changed, show a short caution. If a verified replacement build starts successfully, clear the old caution with a brief dismissal that respects reduced motion. If the replacement fails, show the new failure. Retrying or replacing the tool preserves its saved data.

**Release gate**

- [ ] Publish a real Quick Notes build. Install it from a link on Syntax Dev, open it from install success and Extensions, and open it from the command palette.
- [ ] Verify autosave after refresh, after disabling and enabling, and after uninstall and reinstall. Exercise a save failure and show the user what happened.
- [ ] Use a deliberately failing fixture to verify the crash notification, **Inspect**, the same-build retry caution, and replacement recovery. Keep a healthy extension open through the test.
- [ ] Have another reviewer follow the authoring walkthrough with no setup beyond what's documented. Record what worked, fix any friction, and rerun the full V1.0 and V1.1 checks on the candidate. One successful Quick Notes install does not close the milestone.

### V1.2 Course UI and progress

Publish `@syntax/api` for host services and `@syntax/ui` for shared controls and learning components. Syntax and installed extensions use the same live UI implementation. Start with what a complete lesson needs. Provide guidance, example grading, and reusable controls. Courses can supply their own grading and completion rules, use a custom interaction, or build a different layout. Keep mathematics, code editors, and other subject-specific engines in course packages or separate kits.

**Release gate**

- [ ] Complete a real MPM2D Analytic Geometry lesson on desktop and mobile, in light and dark mode, and using a keyboard. Check the graph axes, points, and line against the lesson background. Exercise the same shared components in a small example from another subject.
- [ ] Change a shared control in Syntax and verify that an installed example picks up the change without rebuilding the extension. During alpha and beta, update official extensions alongside breaking `@syntax/ui` changes. Commit to backward compatibility at the public UI API's v1.0.
- [ ] Show a progress count in Library when a course supplies one. Preserve it on reinstall. At the bottom of Profile, allow deleting one course's saved data without affecting other courses or the account.

### V1.3 Embedded extensions, tools, and themes

An embedded extension is required course-owned behavior. Represent it explicitly in course source when it needs setup, registration, or cleanup. Bundle it in the same course release. A standalone tool has its own install and can contribute an optional feature inside a course. Ordinary course styles apply within the course. A user-enabled theme can deliberately style the whole app.

**Release gate**

- [ ] A fresh course install includes every required interaction. Updating or disabling the course updates or removes its embedded behavior together.
- [ ] Install one real optional tool, such as Pen Studio or Formula Playbook, and use it in the course. Disable it while the course is open. The course still teaches and grades, and the optional control disappears cleanly. Course details can recommend the tool.
- [ ] Enable and disable a small theme and command extension. Verify app-wide styling only when enabled, removal of the styling and command on disable, and recovery if the extension throws.

### V1.4 Publishing, discovery, and docs

Give authors and agents two complete paths. **Build a Course** starts with a subject-neutral starter and one working lesson. **Build a Tool** adds a screen and a command. Both show how to build, publish, and install in Syntax Dev. Keep these guides in the same repo as the API. Fumadocs publishes them for the rolling Dev build. Storybook runs the component and example demos. Public repository skills give agents deeper instructions and evidence outside the docs site.

**Release gate**

- [ ] A new author or agent can follow either guide from a fresh checkout through a working install. Courses appear in Library and tools in their documented location after successful installs. Test Community Hub discovery and direct manifest links.
- [ ] Publish a build with separate listing screenshots. The course download contains the images needed in lessons. The listing carries its preview images. Attach a screenshot from the running app or generate it from an example that runs in Storybook.
- [ ] Verify compatible course and tool releases update automatically during alpha. A rejected build leaves the working install usable. Keep the full versioning and upgrade design for later.
- [ ] Test both tutorials, links, and Storybook examples from the release commit. Verify the site shows the Dev build it describes, while the two authoring guides, runnable source, and deeper agent instructions have stable source links.

### V1.5 Release rehearsal

Run the real official course, the optional tool, and the small theme and command extension through the same paths a student or author will use. Verify normal use on fresh and returning browser profiles, including installed content, preferences, progress, and failure recovery. Review the [historical UI feedback](#earlier-product-feedback) on the deployed build.

**Release gate**

- [ ] Pass `npm run build`, `npm run test:unit`, and `npm run test:e2e` for the candidate. Verify desktop and mobile behavior against the deployed commit as well as in CI.
- [ ] Push two quick updates to a preview PR and close it. Verify the comment names the correct commit, links the exact build, and stops advertising the preview after close. Rehearse the fork or unauthorized case. Confirm the preview leaves Dev alone.
- [ ] Manually deploy a merged commit to Dev without cutting a Nightly. Run a Nightly independently and verify its prerelease and docs point to the same source. Verify Beta publishes a regular release in Syntax and points to its separate student site. Test that an unapproved commit cannot reach Beta or Stable. Stable stays on its intended build throughout.
- [ ] Walk through one student-facing Beta release and recovery. Record the exact commit, build and site links, review findings, and evidence for the previous gates. Resolve blockers before advancing.

### V2 release gate

- [ ] Every V1 milestone has a passed gate and linked evidence.
- [ ] The official course, optional tool, and theme and command extension work together on the release candidate. A fresh browser can install and use all three. At least one other subject works with the shared learning UI.
- [ ] The same candidate passes the release rehearsal, including docs, Beta publishing, and a same-browser check that preview and Dev activity cannot alter Stable data.
- [ ] The maintainer confirms the release. Tag the tested commit explicitly. Moving Stable to the new runtime is a separate release decision.

## Release channels

| Channel | Audience and source | Site and GitHub visibility |
| --- | --- | --- |
| Infra PR preview | Reviewers. Build the exact PR head on each eligible open or updated PR. | A separate hostname per PR, such as `pr-42.syntax-infra.pages.dev`. Update one bot comment with a rolling preview link, an exact build link, and the commit. It leaves Dev, Beta, and Stable untouched. |
| Dev on demand | Maintainer. Choose a merged `main` commit after reviewing the PR. | Deploy that commit to Syntax Dev without tagging or publishing a GitHub release. |
| Nightly | Maintainer. Automate from eligible `main` commits and allow a manual run. | Deploy to Syntax Dev and publish a GitHub **prerelease** in `syntax-platform/syntax`. Frequent Nightlies share one rolling docs destination. |
| Beta | Students and invited testers. Check for an eligible changed build every two days. | Deploy to the separate Beta domain. Publish a regular GitHub **release** in `syntax-platform/syntax` linking to the Beta site, even if the site is hosted from another repo. Set the release so Stable remains the default latest release. |
| Stable | Public. Explicit promotion of a tested commit. | Keep the existing site and release track. Beta and Nightly tags must stay outside Stable promotion during the transition. |

Use the existing release-notes generator for Beta. GitHub Models can summarize changes since the last Beta. Its output is release copy. The workflow selects an accepted commit, applies the tests, and can fall back to deterministic notes. Use the same candidate commit for the artifact, site, tag, and release notes. Verify the commit the site serves before announcing the release. Rehearse restoring the last working Beta, including a failure after uploading the build and before publishing the GitHub release.

For the Infra workflow, build PR code without deployment keys or production auth configuration. Publish only files from the resulting build, on an origin separate from the student and production sites. Start with branches in the Syntax repo and add fork publishing once the artifact and privileges are separated and verified. GitHub Pages project paths on `syntax-platform.github.io` share a browser origin. Paths alone do not isolate storage or cookies. Infra can acquire other jobs later without turning it into the source repo or moving the main release list.

T3 Code uses a separate, labeled PR preview workflow, keeps the nightly and production site aliases untouched during PR previews, and updates one comment with the exact build link. Its scheduled check can run more often than it publishes. The current release runbook describes a 30-minute check, a six-hour interval between automatic releases, a new-commits requirement, and manual dispatch. Use those channel boundaries as the reference for Syntax's different schedule. [T3 Code PR preview workflow](https://github.com/pingdotgg/t3code/blob/main/.github/workflows/web-preview.yml) · [T3 Code release runbook](https://github.com/pingdotgg/t3code/blob/main/docs/operations/03_release.md) · [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

### Deployment setup and cutover

1. **Dev.** The `syntax-dev` repository serves the original [public Dev URL](https://syntax-platform.github.io/syntax-dev/) directly from `gh-pages`. Both Dev workflows publish to this repository. The stable app stays at [/syntax/](https://syntax-platform.github.io/syntax/). Verify hash routes and Clerk sign-in during the first workflow run.
2. **Infra.** Keep infrastructure configuration in `syntax-infra`. The Cloudflare Pages project also uses `syntax-infra` and gives each PR a separate browser origin. Set `SYNTAX_INFRA_ORIGIN` to the assigned project origin. Verify that a same-repo PR comment updates on pushes and stops advertising the preview when the PR closes. Cloudflare controls retention of old preview URLs. [Cloudflare Pages previews](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
3. **Beta.** Keep Beta deployment configuration under `syntax-beta-domain`. Create the separate Direct Upload project `syntax-beta` and set `SYNTAX_BETA_ORIGIN` to its assigned HTTPS origin. If Beta supports sign-in, give it its own Clerk instance and `VITE_CLERK_BETA_PUBLISHABLE_KEY`. Enable `SYNTAX_BETA_ENABLED` for the rehearsal and subsequent scheduled publishing. Set `SYNTAX_BETA_APPROVED_SHA` to the accepted commit. The schedule has alternating UTC-day slots, skips an already published commit, and allows a manual run. Beta release tags use a `beta-v` prefix. Stable tags and the default latest release remain independent.

Set `CLOUDFLARE_ACCOUNT_ID` as a Syntax repository variable. Store a Pages-scoped token as `CLOUDFLARE_PAGES_TOKEN` in the `syntax-infra` and `syntax-beta` Actions environments. Use the actual origin Cloudflare assigns if the preferred project name is taken. Cloudflare provides separate HTTPS addresses without a purchased domain. [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)

The workflow files live under `.github/workflows`. Each deployment must be verified against a commit marker or build checksum before being described as live. The new workflows require a merge to `main` and configured hosting before a real deployment test.

## Documentation and the generated wiki

Write and review the canonical docs alongside the code. Publish one docs site for the current `main` prerelease or Nightly. Show the exact commit or build it describes. A manual Dev deployment can be ahead of or behind that Nightly. When a PR changes public behavior, update the tutorial, reference, and runnable example that describe it in the same PR. Frequent Nightlies refresh the existing site. Beta can use source permalinks for its release. The latest direction replaces the earlier plan to publish snapshots for supported releases. [Fumadocs static build](https://www.fumadocs.dev/docs/deploying/static) · [Storybook embeds](https://storybook.js.org/docs/sharing/embed)

DeepWiki can help a maintainer or agent navigate the code. The free public T3 Code wiki explains its web, desktop, and server architecture with links to source. Starlight's generated documentation page traces search and configuration to specific files. Obsidian's generated API pages organize lifecycle, commands, and storage around its type declarations. They cover indexed revisions that can differ from the deployed Nightly. The T3 Code wiki showed a three-day wait before the next manual refresh when inspected. Its maintained runbook explains release ordering and which previews can publish. Keep the Syntax walkthroughs and release policy in reviewed PRs so they match the build authors actually use. Use the generated wiki as an optional reference. [Cognition's free public indexing](https://cognition.com/blog/deepwiki) · [T3 Code generated architecture](https://deepwiki.com/pingdotgg/t3code/2-architecture) · [Starlight generated docs](https://deepwiki.com/withastro/starlight/9-showcase-and-examples) · [Obsidian generated API](https://deepwiki.com/obsidianmd/obsidian-api/2-core-architecture)

## Feedback index

Search by topic, ID, or original question number. Add new feedback here with its milestone and source. Amend the existing decision if a later answer changes it, and record the earlier direction under **Superseded decisions**. For implementation PRs, link the feedback ID, exact tested commit, and evidence under the milestone it affects.

### Confirmed decisions

| ID | Feedback | Where it lands |
| --- | --- | --- |
| EXT-01 | Build a general extension system. Prove a tool can add a screen and command, and let extensions work together. Use “extensions” in the product. | V1.0, V1.1, V1.3 |
| EXT-02 | Fix the install-to-Library gap found in the test course. A real course lives in its own project or official extension package and uses native UI. Keep courses, course data, and subject engines out of core. | V1.2, V1.4 |
| EXT-03 | Disable the extension responsible for a crash and show a clear in-app notification. Recover on reload after interrupted startup. Keep the failed tool visible with Inspect and Re-enable. Warn when retrying the same build. Clear the warning when a verified replacement starts. Q27. | V1.0, V1.1 |
| EXT-04 | Quick Notes is the first real tool. Limit it to one autosaved text scratchpad, a screen, and a command. Show Open after install and make it easy to find again in Extensions. Q23–Q26. | V1.1 |
| UI-01 | Launch a live, public Syntax UI library for Syntax courses and tools. Start small, prove quality in a real lesson and a second subject, and grow the component set from use. Allow breaking API changes through beta. Q1–Q2 and the earlier compatibility question. | V1.2 |
| UI-02 | Supply lesson guidelines, tools, and shared components. Let a course supply its own lesson and grading behavior. Q13. | V1.2 |
| UI-03 | Scope ordinary course styles. Reserve app-wide style changes for themes the student enables. Q4. | V1.3 |
| COURSE-01 | Represent required embedded extensions in course code. Recommend standalone tools for extra features useful across courses. List author-recommended tools on course details. Q6, Q8. | V1.3 |
| DATA-01 | Keep course data local while Clerk syncs installs and preferences. Show progress when a course provides it. Preserve it on uninstall and offer per-course deletion at the bottom of Profile. Q14, Q16, Q21. | V1.1, V1.2 |
| DATA-02 | Existing Stable course progress migration is outside the current release requirements. Q10. | V2 scope |
| DOC-01 | Ship **Build a Course** and **Build a Tool** together. Start with a generic course, use live examples, document publishing and installation on Dev, and expose source for agents and the future MCP. Q5, Q17. | V1.4 |
| DOC-02 | Keep docs beside the API. Use Fumadocs for the public site, Storybook for tested examples, and focused repository skills for agents. Deeper instructions and evidence stay in public source outside the site. Q18, Q20. | V1.4 |
| DOC-03 | Publish one rolling main/Nightly docs site. Compare DeepWiki with the reviewed guides. Keep PRs responsible for documentation changes. | V1.4 |
| PUB-01 | Provide Community Hub and direct install links. GitHub hosting details can stay behind the agent workflow. Publish screenshots with listings and lesson assets with packages. Q19. | V1.4 |
| PUB-02 | Automatically install compatible alpha updates as a temporary measure. Leave long-term updater behavior for later and study T3 Code when that work begins. Q9, Q11. | V1.4, later |
| REL-01 | Keep the existing runtime on Stable while Dev adopts the new runtime. Split work into usable V1 milestones and strengthen each before moving on. Q7 and milestone feedback. | All milestones |
| REL-02 | Give PRs isolated Infra previews, give merged changes an on-demand Dev deployment, and keep Nightly prereleases independent. Beta serves students every two days when a build qualifies. Its regular release appears under Syntax even though its site is separate. | V1.0, V1.5 |
| REL-03 | Use CodeRabbit on small public repos with manual triggers below 10 stars. Keep release notes concise and user-facing. | All milestones |
| REL-04 | Build and review the infrastructure and authoring flow before Quick Notes. Test each milestone with several cases, fix its defects, and verify the exact build before moving on. Q28 follow-up. | All milestones |

### Earlier product feedback

Use this list when checking regressions and planning separate product work. Verify the current build before marking an older issue open or fixed.

- **Shell and navigation.** Keep Home and Library easy to reach. The mobile tab bar, slider and underline styles, profile dropdown, and hamburger menu need careful review. Settings should replace the top tabs with Settings, Extensions, Courses, and Community Hub. Put **Back to Library** before the main tabs, with space and a smooth transition. Check the active selector on load and the return animation. Keep the dropdown clear of redundant account actions and omit the workspace section from Profile.
- **Library and settings.** Avoid duplicate empty-state shortcuts when the empty state already links to Extensions and Community Hub. Keep the import action useful. Revisit unclear “extension views” wording and weak icons. Check the requested reset controls beside color mode, navigation style, and the Syntax logo destination. Preserve the welcome-back experience the user liked.
- **Mobile and visual quality.** Use the existing visual style as a quality reference. Check contrast and legibility in both themes, strong spacing and hierarchy, polished mobile navigation, and layout at real breakpoints. Keep Syntax's design original. Treat announced deploys and verified live deploys as distinct evidence.
- **Sema and accounts.** Sema remains core. Earlier feedback favored pixel-art exploration and called out the header and idle animations and Sema Studio. Keep that product work separate from the extension MVP. Clerk integration can deepen later. The user declined GitHub OAuth sign-in.
- **Project presentation.** The core README and organization describe Syntax as an extensible learning platform. Keep official course material and the video pipeline with first-party extensions. Keep public repo copy clean, make Nightly prereleases easy to find, and replace generic or overdesigned branding text when touching those pages.

### Superseded decisions

- The earlier archive and worker/iframe designs are useful history. The new Dev runtime targets native extensions. The [existing V1 architecture](ARCHITECTURE.md) remains the reference for the runtime in Stable.
- The public course starter is subject-neutral. MPM2D is a real integration proof and supplied examples of shared UI needs.
- Course progress stays local. The earlier option to sync completion checkmarks through Clerk was replaced in the follow-up answer.
- The first docs site is one rolling main/Nightly site. Per-release public snapshots are outside the current plan.
- The old single V2 alpha bundle became multiple V1 milestones. Continue from the Library and local author preview stay deferred according to the later decisions.
- The first product proof follows a separate foundation gate. Quick Notes is one part of V1.1 acceptance.

## V2.5 and later

- **V2.5.** Run a local course or tool in Syntax Dev before publishing. Offer **Continue** from the Library when a course can supply the lesson to resume. Q12, Q15.
- **Later updater.** Study T3 Code and plan update timing, version selection, recovery, and state compatibility. The temporary alpha updater is enough for the early milestones.
- **Later MCP authoring system.** Build the larger catalog of runnable mockups, reference courses and tools, screenshots, and focused skills. Plan specialist MCP components after enough real extension authoring work shows what they need. Storybook and the public source provide usable examples in the meantime.
