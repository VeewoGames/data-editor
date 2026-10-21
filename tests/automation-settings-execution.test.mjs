import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function buildAutomationValidationIssuesByRuleId(');
const end = source.indexOf('function resolveVisibleEntryActions(', start);
const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const { validateAutomationSettings, buildAutomationValidationIssuesByRuleId, describeAutomationRuleStatus } = new Function(`${js}; return {validateAutomationSettings, buildAutomationValidationIssuesByRuleId, describeAutomationRuleStatus};`)();
const rule = kind => ({ id:'generate', label:'Generate', icon:'refresh', enabled:true, contractId:'generate.v1', targets:[{file:'data/items.json', collection:'items'}], execution:{kind, resultPolicy:'proposal', command:{path:'tools/generate.mjs', args:[], readDependencies:[], timeoutMs:1000}} });
const empty = {defaults:{}, bindings:{}};
test('project command settings save without an AI binding', () => {
  const profile = {rules:[rule('project-command')]};
  assert.deepEqual(validateAutomationSettings(profile, empty), []);
  assert.deepEqual(buildAutomationValidationIssuesByRuleId(profile, empty).generate, []);
});
test('project commands ignore obsolete AI binding status', () => {
  const profile = {rules:[rule('project-command')]};
  const bindings = {...empty, bindings:{generate:{provider:'codex',skill:'',enabled:false}}, bindingStatuses:{generate:{status:'invalid',message:'old AI failure'}}};
  assert.deepEqual(validateAutomationSettings(profile, bindings), []);
  assert.deepEqual(buildAutomationValidationIssuesByRuleId(profile, bindings).generate, []);
  assert.equal(describeAutomationRuleStatus(profile.rules[0], bindings.bindings.generate, 0), '正常');
});
test('AI execution still requires a skill binding', () => {
  const profile = {rules:[rule('project-skill')]};
  assert.match(validateAutomationSettings(profile, empty).join(), /缺少 binding/);
  assert.match(buildAutomationValidationIssuesByRuleId(profile, empty).generate.join(), /缺少本机绑定/);
  const bindings = {...empty, bindings:{generate:{provider:'codex',skill:'review',enabled:true}}};
  assert.deepEqual(validateAutomationSettings(profile, bindings), []);
  assert.deepEqual(buildAutomationValidationIssuesByRuleId(profile, bindings).generate, []);
});
