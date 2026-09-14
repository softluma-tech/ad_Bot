const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReport } = require('../src/bot/admin');

test('formatReport lists cid with user counts', () => {
  const rows = [
    { _id: 'cid_insta', count: 57 },
    { _id: 'cid_telegram', count: 43 },
    { _id: 'cid_yt', count: 38 },
  ];
  const txt = formatReport(rows, 138);
  assert.ok(txt.includes('<b>Cid Report</b>'));
  assert.ok(txt.includes('Total users: <b>138</b>'));
  assert.ok(txt.includes('Cid: <b>cid_insta</b> — <b>57</b> users'));
  assert.ok(txt.includes('Cid: <b>cid_telegram</b> — <b>43</b> users'));
  assert.ok(txt.includes('Cid: <b>cid_yt</b> — <b>38</b> users'));
});

test('formatReport renders no-cid group', () => {
  const txt = formatReport([{ _id: null, count: 14 }], 14);
  assert.ok(txt.includes('Cid: <b>— no cid</b> — <b>14</b> users'));
});

test('formatReport renders empty and blank cids as no cid', () => {
  const txt = formatReport([{ _id: '', count: 2 }], 2);
  assert.ok(txt.includes('Cid: <b>— no cid</b>'));
});

test('formatReport falls back when there are no rows', () => {
  const txt = formatReport([], 0);
  assert.ok(txt.includes('No users yet.'));
});