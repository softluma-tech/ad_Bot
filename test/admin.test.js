const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReport, buildDayReport } = require('../src/bot/admin');

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

test('buildDayReport lists each day with new and active counts', () => {
  const rows = [
    { label: 'Mon, 14 Sep', newCount: 10, activeCount: 42, isToday: false },
    { label: 'Tue, 15 Sep', newCount: 7, activeCount: 38, isToday: false },
    { label: 'Wed, 16 Sep', newCount: 3, activeCount: 21, isToday: true },
  ];
  const txt = buildDayReport(3, rows);
  assert.ok(txt.includes('<b>Day-wise Report (last 3 days)</b>'));
  assert.ok(txt.includes('Mon, 14 Sep'));
  assert.ok(txt.includes('New users: <b>10</b>'));
  assert.ok(txt.includes('Active users: <b>42</b>'));
  assert.ok(txt.includes('Wed, 16 Sep (Today)'));
});

test('buildDayReport marks only the latest day as today', () => {
  const rows = [
    { label: 'Yesterday', newCount: 1, activeCount: 1, isToday: false },
    { label: 'Today', newCount: 2, activeCount: 2, isToday: true },
  ];
  const txt = buildDayReport(2, rows);
  assert.ok(txt.includes('<b>Today (Today)</b>'));
  assert.ok(!txt.includes('<b>Yesterday</b>'));
});