const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, truncate, stripHtml } = require('../src/bot/emoji');

test('escapeHtml encodes special characters', () => {
  assert.equal(escapeHtml('<b>&"</b>'), '&lt;b&gt;&amp;"&lt;/b&gt;');
});

test('escapeHtml handles null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml leaves plain text untouched', () => {
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('truncate shortens with ellipsis', () => {
  assert.equal(truncate('abcdef', 3), 'abc…');
});

test('truncate returns string as-is when under limit', () => {
  assert.equal(truncate('abc', 5), 'abc');
});

test('truncate counts code points, not bytes', () => {
  assert.equal(truncate('a😀b', 4), 'a😀b');
});

test('stripHtml removes tg-emoji tags and html tags', () => {
  const input = `<tg-emoji emoji-id="1">🙂</tg-emoji> <b>Hello</b> <a href="x">link</a>`;
  assert.equal(stripHtml(input), '🙂 Hello link');
});

test('stripHtml handles plain text', () => {
  assert.equal(stripHtml('plain'), 'plain');
});