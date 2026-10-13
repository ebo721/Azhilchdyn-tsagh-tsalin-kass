const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const src = fs.readFileSync(__dirname + '/inventoryIssueOptions.ts', 'utf8');
const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(mod.exports, mod);
const { issueCatalogOptions } = mod.exports;
const catalog = [{ id: 1, quantity: 0 }, { id: 2, quantity: 5 }, { id: 3, quantity: -1 }];
test('only positive stock', () => assert.deepEqual(issueCatalogOptions(catalog).map((i) => i.id), [2]));
test('editing keeps original item with restored availability', () => {
  const r = issueCatalogOptions(catalog, { inventoryItemId: 1, quantity: 3 });
  assert.deepEqual(r.map((i) => [i.id, i.available]), [[1, 3], [2, 5]]);
});
test('empty', () => assert.deepEqual(issueCatalogOptions(undefined), []));
