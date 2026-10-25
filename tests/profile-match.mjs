import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const context = {};
vm.runInNewContext(await readFile(new URL('../profile-match.js', import.meta.url), 'utf8'), context);
const suggest = context.familyProfileMatch.suggest;
const users = [
  { id: 'chester', name: 'Chester', first_name: 'Chester', last_name: 'Gloyd' },
  { id: 'rick', name: 'Rick', first_name: 'Rick', last_name: 'Smith' },
  { id: 'pat', name: 'Pat', first_name: 'Pat', last_name: null },
];
test('suggestions start at @ and recognize exact names or initial plus confirmed surname', () => {
  for (const email of ['chester.gloyd@', 'CHESTER.GLOYD@example.test', 'chester1984+travel@x.test']) assert.equal(suggest(email, users)?.id, 'chester');
  for (const email of ['r.smith@', 'rsmith@x.test', 'rick.smith@x.test']) assert.equal(suggest(email, users)?.id, 'rick');
  assert.equal(suggest('pat.unknown@', users)?.id, 'pat');
  for (const email of ['chester', 'r@', 'patrick@example.test', 'chest@example.test', 'chester.smith@', 'r.smith@@x.test']) assert.equal(suggest(email, users), null);
});
test('ambiguous matches stay manual, and registered accounts remain suggestions only', () => {
  assert.equal(suggest('r.smith@', [...users, { id: 'rachel', name: 'Rachel', last_name: 'Smith' }]), null);
  const registered = { id: 'rick', name: 'Rick', last_name: 'Smith', registered: true };
  assert.equal(suggest('r.smith@other.test', [registered]), registered);
  assert.equal(registered.email, undefined);
});
