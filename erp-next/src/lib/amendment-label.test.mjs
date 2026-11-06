import { test } from 'node:test'
import assert from 'node:assert/strict'
import { amendmentLabel } from './amendment-label.ts'

test('first and legacy amendments keep the plain Amendment label', () => {
  for (const ordinal of [undefined, null, 0]) assert.equal(amendmentLabel(ordinal), 'Amendment')
})

test('later amendments display their one-based round number', () => {
  assert.equal(amendmentLabel(1), 'Amendment Round 2')
  assert.equal(amendmentLabel(2), 'Amendment Round 3')
  assert.equal(amendmentLabel(9), 'Amendment Round 10')
})
