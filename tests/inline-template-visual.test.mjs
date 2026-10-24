import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from '@playwright/test';

const fixture='virtual:template-visual-fixture';
const fieldPath=fileURLToPath(new URL('../src/detail/InlineTemplateField.tsx',import.meta.url));
const domPath=fileURLToPath(new URL('../src/detail/inline-template-dom.mjs',import.meta.url));
const original='Text <effect ref="hit"><value ref="damage">30% Power</value> <kw id="slow" mode="default">Slow</kw> <kw id="burn" mode="alt">Burn</kw></effect>. Plain {text} [text] &lt;literal&gt; <cost>Cost.</cost>';
const built=await build({configFile:false,logLevel:'silent',plugins:[{name:'template-visual-fixture',resolveId(id){if(id===fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return `import React from 'react';import {createRoot} from 'react-dom/client';import {InlineTemplateField} from ${JSON.stringify(fieldPath)};import {serializeTemplateNodes} from ${JSON.stringify(domPath)};
const root=createRoot(document.getElementById('root'));let mode='table',active=false,source=${JSON.stringify(original)};window.changes=[];
window.serializeEditor=()=>serializeTemplateNodes(document.querySelector('[role="textbox"]'));
window.renderSource=(next)=>{source=next;active=false;render();};window.setMode=next=>{mode=next;active=false;render();};
function render(){root.render(React.createElement(InlineTemplateField,{projectId:'fixture',sourcePath:'data/items.json',collectionPath:'$',rowId:'one',field:'copy',definition:{field:'copy',label:'描述',languages:[{key:'en',label:'English'}],tableLanguage:'en'},table:mode==='table',interaction:{cellId:'one:copy',editable:true,active,wrapped:true,onEnableEditing(){},onActivate(){active=true;render();},onDeactivate(){active=false;render();}},value:{en:source},onChange:value=>{window.changes.push(value.en);source=value.en;render();},fallback:null}));}render();`;}}],build:{write:false,minify:false,rollupOptions:{input:fixture,output:{format:'iife'}}}});
const script=built.output.find(item=>item.type==='chunk').code,css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
async function mount(page){await page.setContent('<div id="root" style="width:260px"></div><button id="outside">Outside</button>');await page.addStyleTag({content:css});await page.addScriptTag({content:script});await page.locator('.inline-template-display [data-template-ref]').waitFor();}
async function colors(surface){return surface.locator('[data-template-ref],[data-template-keyword]').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return {text:node.textContent,bg:s.backgroundColor,color:s.color,border:s.borderTopWidth,shadow:s.boxShadow,display:s.display};}));}

test('table display, table editing and detail share token identity and borderless colors without coloring literal brackets',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await mount(page);
 const display=page.locator('.inline-template-display');assert.equal(await display.locator('[data-template-ref],[data-template-keyword]').count(),3);assert((await display.innerText()).includes('Plain {text} [text] <literal>'));
 const browseColors=await colors(display);assert.equal(browseColors[0].bg,'rgb(234, 242, 255)');assert.equal(new Set(browseColors.map(x=>x.bg)).size,3);assert(browseColors.every(x=>x.border==='0px'&&x.shadow==='none'));assert(browseColors.every(x=>x.display==='inline'),'wrapped table tokens must stay inline');
 assert(await display.locator('[data-template-effect],[data-template-section],[data-template-literal]').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).display==='inline')),'transparent author scopes must stay inline');assert.equal(await display.evaluate(node=>getComputedStyle(node).display),'block');
 await page.locator('[data-cell-role="content"]').click();const editor=page.getByRole('textbox');await editor.waitFor();assert.deepEqual(await colors(editor),browseColors);assert.equal(await page.evaluate(()=>window.serializeEditor()),original);
 await page.locator('#outside').click();await page.evaluate(()=>window.setMode('detail'));await editor.waitFor();assert.deepEqual(await colors(editor),browseColors);
 await editor.click();await page.keyboard.press('Control+Home');await page.keyboard.type('X');const before=await page.evaluate(()=>window.serializeEditor());
 await page.evaluate(()=>{window.originalValueNode=document.querySelector('[role="textbox"] [data-template-ref]');document.documentElement.dataset.theme='dark';});assert(await page.evaluate(()=>window.originalValueNode===document.querySelector('[role="textbox"] [data-template-ref]')));assert.equal(await page.evaluate(()=>window.serializeEditor()),before);assert.equal((await colors(editor))[0].bg,'rgb(38, 59, 85)');
 await page.locator('#outside').click();assert.equal(await page.evaluate(()=>window.changes.at(-1)),'X'+original);
 }finally{await browser.close();}
});

test('shared display preserves diagnostics, escaped controls and mixed malformed fragments without inventing identities',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await mount(page);
 const mixed='Good <value ref="n">1</value> <kw broken>literal [unbound] &lt;kw id=&quot;fake&quot; mode=&quot;alt&quot;&gt;literal&lt;/kw&gt;';
 await page.evaluate(source=>window.renderSource(source),mixed);const display=page.locator('.inline-template-display');await page.waitForFunction(()=>document.querySelector('.inline-template-display')?.textContent.includes('Good'));
 assert.equal(await display.locator('[data-template-ref]').count(),1);assert.equal(await display.locator('[data-template-keyword]').count(),0);
 await page.locator('[data-cell-role="content"]').click();await page.getByRole('textbox').waitFor();assert.equal(await page.evaluate(()=>window.serializeEditor()),mixed);
 const legacy='Missing <value ref="n" />';await page.evaluate(source=>window.renderSource(source),legacy);await page.waitForFunction(()=>document.querySelector('[data-template-unresolved-raw]'));
 const diagnostic=display.locator('[data-template-unresolved-raw]');assert.match(await diagnostic.innerText(),/缺可读源文/);assert.equal(await diagnostic.evaluate(node=>getComputedStyle(node).outlineStyle),'dashed');
 await page.locator('[data-cell-role="content"]').click();await page.getByRole('textbox').waitFor();assert.equal(await page.evaluate(()=>window.serializeEditor()),legacy);
 }finally{await browser.close();}
});
