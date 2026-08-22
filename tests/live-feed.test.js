const test = require('node:test');
const assert = require('node:assert/strict');
const Feed = require('../live/feed-curator.js');

test('classifies high-signal feed categories conservatively', () => {
  assert.equal(Feed.classifyLabel('Sol working'), 'sol');
  assert.equal(Feed.classifyLabel('Sol thinking'), 'sol');
  assert.equal(Feed.classifyLabel('Worker returned'), 'workers');
  assert.equal(Feed.classifyLabel('Work conversation'), 'workers');
  assert.equal(Feed.classifyLabel('Quality rejected'), 'review');
  assert.equal(Feed.classifyLabel('Quality accepted'), 'review');
  assert.equal(Feed.classifyLabel('Deployment live'), 'company');
  assert.equal(Feed.classifyLabel('Council exchange'), 'company');
});

test('consecutive routine Sol events collapse but major events break the run', () => {
  const a = { label: 'Sol working', id: '1' };
  const b = { label: 'Sol thinking', id: '2' };
  const c = { label: 'Worker returned', id: '3' };
  const d = { label: 'Sol working', id: '4' };
  const e = { label: 'Sol working', id: '5' };
  const groups = Feed.groupRoutineSol([a, b, c, d, e]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map(x => x.id), ['1', '2']);
  assert.deepEqual(groups[1].map(x => x.id), ['4', '5']);
});

test('day or structural boundaries stop Sol grouping', () => {
  const groups = Feed.groupRoutineSol([
    { label: 'Sol working', id: '1' },
    { boundary: true },
    { label: 'Sol thinking', id: '2' },
    { label: 'Sol working', id: '3' }
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(x => x.id), ['2', '3']);
});

test('filters never cross categories', () => {
  for (const cat of ['company', 'workers', 'sol', 'review']) {
    assert.equal(Feed.filterAllows('all', cat), true);
    assert.equal(Feed.filterAllows(cat, cat), true);
  }
  assert.equal(Feed.filterAllows('workers', 'sol'), false);
  assert.equal(Feed.filterAllows('review', 'company'), false);
  assert.equal(Feed.filterAllows('junk', 'company'), true);
});

test('group span is factual duration only', () => {
  assert.equal(Feed.spanLabel([
    { ts: '2026-08-22T17:00:00Z' },
    { ts: '2026-08-22T17:00:45Z' }
  ]), '45s span');
  assert.equal(Feed.spanLabel([
    { ts: '2026-08-22T17:00:00Z' },
    { ts: '2026-08-22T17:03:10Z' }
  ]), '3m span');
});
