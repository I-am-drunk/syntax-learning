import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertStableTagTarget, selectStableCommit } from '../../.github/scripts/check-nightly-release.mjs'

const approved = 'a'.repeat(40)
const nightly = 'b'.repeat(40)
const dispatch = {
  eventName: 'workflow_dispatch',
  eventRef: 'refs/heads/main',
  defaultBranch: 'main',
  requestedSha: approved,
  approvedSha: approved,
}

test('Stable dispatch selects only the explicitly approved full commit', () => {
  assert.equal(selectStableCommit(dispatch), approved)
  for (const requestedSha of ['', nightly, approved.slice(0, 8)]) {
    assert.throws(() => selectStableCommit({ ...dispatch, requestedSha }), /commit input must match/)
  }
  assert.throws(() => selectStableCommit({ ...dispatch, approvedSha: '' }), /full commit SHA/)
})

test('Stable rejects tag pushes and dispatch from a branch other than main', () => {
  assert.throws(() => selectStableCommit({ ...dispatch, eventName: 'push', eventRef: 'refs/tags/v2.0.0' }), /dispatched from main/)
  assert.throws(() => selectStableCommit({ ...dispatch, eventRef: 'refs/heads/preview' }), /dispatched from main/)
})

test('a Stable release cannot reuse a tag bound to a different build', async () => {
  const github = {
    rest: {
      git: { getRef: async () => ({}) },
      repos: { getCommit: async () => ({ data: { sha: nightly } }) },
    },
  }
  await assert.rejects(assertStableTagTarget({ github, owner: 'syntax-platform', repo: 'syntax', tag: 'v2.0.0', sha: approved }), /already points to/)
  await assertStableTagTarget({ github, owner: 'syntax-platform', repo: 'syntax', tag: 'v2.0.0', sha: nightly })
})
