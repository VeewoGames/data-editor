import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual App callbacks, including their field universe, rather
// than duplicating the ordering algorithm in a test-only helper.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['handleReorderFields', 'handleMoveField', 'orderColumns', 'getOrderedFields']);
const declarations = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(declarations.length, names.size);
const compiled = ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function callbacks(order = ['use', 'name', 'ingame', 'back_source']) {
  const layout = { order: [...order], hidden: ['name'] };
  const fields = ['use', 'name', 'back_source'];
  const allFields = [...order];
  const handlers = new Function('selectedPath', 'model', 'collectionPath', 'fieldConfig', 'backlinkColumns', 'allFields', 'getMainColumns', 'getNestedFields', 'updateActiveViewLayout', `${compiled}; return {handleReorderFields, handleMoveField};`)(
    'content.json', {}, 'rows', layout, [{ fieldName: 'back_source' }], allFields,
    () => fields.slice(0, 2), () => [], mutator => mutator(layout),
  );
  return { ...handlers, layout };
}
test('drag order retains a declared generated field between source columns', () => {
  const app = callbacks();
  app.handleReorderFields(['use', 'ingame', 'back_source']);
  assert.deepEqual(app.layout.order, ['use', 'ingame', 'back_source', 'name']);
  assert.deepEqual(app.layout.hidden, ['name']);
});
test('move left and right both include generated fields in the display order', () => {
  const app = callbacks();
  app.handleMoveField('ingame', 'left');
  assert.deepEqual(app.layout.order, ['use', 'ingame', 'name', 'back_source']);
  // A fresh render supplies the updated display order.
  const next = callbacks(app.layout.order);
  next.handleMoveField('ingame', 'right');
  assert.deepEqual(next.layout.order, ['use', 'name', 'ingame', 'back_source']);
});
test('drag normalizes unknown and repeated fields while preserving all known columns', () => {
  const app = callbacks();
  app.handleReorderFields(['ingame', 'ingame', 'obsolete', 'use']);
  assert.deepEqual(app.layout.order, ['ingame', 'use', 'name', 'back_source']);
});
