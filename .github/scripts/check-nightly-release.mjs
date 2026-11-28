const MINIMUM_NIGHTLY_GAP_MS = 6 * 60 * 60 * 1000

export function isNightlyTag(tag) {
  return /^v\d+\.\d+\.\d+-(?:nightly|alpha)\./.test(tag)
}

export function isStableTag(tag) {
  return /^v\d+\.\d+\.\d+$/.test(tag)
}

export function parseBaseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(tag || '').trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareBaseVersions(a, b) {
  const pa = parseBaseVersion(a) ?? [0, 0, 0]
  const pb = parseBaseVersion(b) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export function resolveNextBaseVersion({ latestStableTag, pkgVersion }) {
  const stableParts = parseBaseVersion(latestStableTag)
  const bumpedFromStable = stableParts
    ? `${stableParts[0]}.${stableParts[1] + 1}.0`
    : '0.1.0'
  if (pkgVersion && compareBaseVersions(pkgVersion, bumpedFromStable) > 0) {
    return pkgVersion.replace(/^v/, '')
  }
  return bumpedFromStable
}

export function formatNightlyTag({ baseVersion, dateStr, runNumber }) {
  const cleanBase = baseVersion.replace(/^v/, '')
  const version = `${cleanBase}-nightly.${dateStr}.${runNumber}`
  return {
    version,
    tag: `v${version}`,
  }
}

export function formatPreviewTag({ baseVersion, dateStr, runNumber }) {
  const cleanBase = baseVersion.replace(/^v/, '')
  const version = `${cleanBase}-preview.${dateStr}.${runNumber}`
  return {
    version,
    tag: `v${version}`,
  }
}

const RELEASES_QUERY = `
  query ($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      releases(first: 100, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          tagName
          isDraft
          isPrerelease
          publishedAt
        }
      }
    }
  }
`

export async function listPublishedReleases({ github, owner, repo }) {
  const results = []
  let cursor = null
  do {
    const { repository } = await github.graphql(RELEASES_QUERY, { owner, repo, cursor })
    const { nodes, pageInfo } = repository.releases
    for (const r of nodes) {
      if (!r.isDraft && r.publishedAt) {
        results.push(r)
      }
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (cursor && results.length < 300)
  return results.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

export function findLatestRelease(releases, predicate) {
  return releases.find(r => predicate(r.tagName, r)) ?? null
}

export async function assertCommitOnDefaultBranch({ github, owner, repo, defaultBranch, sha }) {
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${sha}...${defaultBranch}`,
    per_page: 1,
  })
  if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
    throw new Error(
      `Release commit ${sha} is not contained in ${defaultBranch} (${comparison.status}).`,
    )
  }
}

export async function shouldReleaseNightly({
  github,
  owner,
  repo,
  sha,
  releases,
  core,
  now = Date.now(),
}) {
  const lastNightly = findLatestRelease(releases, tag => isNightlyTag(tag))
  if (!lastNightly) {
    core.info('No published nightly found yet. Proceeding with nightly release.')
    return true
  }

  const elapsed = now - Date.parse(lastNightly.publishedAt)
  if (elapsed < MINIMUM_NIGHTLY_GAP_MS) {
    core.info(`Latest nightly ${lastNightly.tagName} was published less than 6 hours ago. Skipping.`)
    return false
  }

  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${lastNightly.tagName}...${sha}`,
    per_page: 1,
  })
  if (comparison.status !== 'ahead') {
    core.info(`Candidate commit is ${comparison.status} relative to ${lastNightly.tagName}. Skipping.`)
    return false
  }

  core.info(`New commits found since ${lastNightly.tagName} and 6-hour gap elapsed.`)
  return true
}

export function selectStableCommit({ eventName, eventRef, defaultBranch, requestedSha, approvedSha }) {
  if (eventName !== 'workflow_dispatch' || eventRef !== `refs/heads/${defaultBranch}`) {
    throw new Error(`Stable releases must be dispatched from ${defaultBranch}.`)
  }
  if (!/^[0-9a-f]{40}$/.test(approvedSha)) {
    throw new Error('Stable releases require a full commit SHA in SYNTAX_STABLE_APPROVED_SHA.')
  }
  if (requestedSha !== approvedSha) {
    throw new Error('The commit input must match SYNTAX_STABLE_APPROVED_SHA.')
  }
  return approvedSha
}

export async function assertStableTagTarget({ github, owner, repo, tag, sha }) {
  try {
    await github.rest.git.getRef({ owner, repo, ref: `tags/${tag}` })
  } catch (error) {
    if (error.status === 404) return
    throw error
  }
  const { data: commit } = await github.rest.repos.getCommit({ owner, repo, ref: `refs/tags/${tag}` })
  if (commit.sha !== sha) {
    throw new Error(`Stable tag ${tag} already points to ${commit.sha}, expected ${sha}.`)
  }
}

export function resolvePreviousTag({ releases, channel, currentTag }) {
  if (channel === 'stable') {
    const prev = findLatestRelease(
      releases,
      tag => tag !== currentTag && isStableTag(tag),
    )
    return prev?.tagName ?? ''
  }
  if (channel === 'nightly') {
    const prev = findLatestRelease(
      releases,
      tag => tag !== currentTag && (isNightlyTag(tag) || isStableTag(tag)),
    )
    return prev?.tagName ?? ''
  }
  return ''
}
