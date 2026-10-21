import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {chromium} from '@playwright/test';

// In-memory browser fixture: no production data, service, temporary server or port.
const fixture='virtual:inline-template-draft-fixture';
const source='Deal <value ref="damage">30% Power</value> damage and <kw id="slow" mode="default">Slow</kw>.测试';
const built=await build({configFile:false,logLevel:'silent',plugins:[{name:'inline-template-draft-fixture',resolveId(id){if(id===fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return `import React from 'react';import {createRoot} from 'react-dom/client';import {TemplateEditor} from ${JSON.stringify(new URL('../src/detail/InlineTemplateField.tsx',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))};
const root=createRoot(document.getElementById('root'));let props={identity:'fixture:row:copy:en',source:${JSON.stringify(source)},values:{damage:{label:'30% Power'}},onChange:value=>window.changes.push(value)};window.changes=[];window.renderFixture=next=>{props={...props,...next};root.render(React.createElement(TemplateEditor,props));};window.renderFixture({});`;}}],build:{write:false,minify:false,rollupOptions:{input:fixture,output:{format:'iife'}}}});
const script=built.output.find(item=>item.type==='chunk').code;

test('missing readable body remains diagnostic while adjacent editing preserves original bytes',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  const legacy='Before <value ref="damage"    /> after';await page.evaluate(source=>window.renderFixture({source}),legacy);const editor=page.getByRole('textbox');await editor.waitFor();assert.match(await editor.innerText(),/缺可读源文：damage/);
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('!');await page.locator('#outside').click();assert.equal(await page.evaluate(()=>window.changes.at(-1)),legacy+'!');
 }finally{await browser.close();}
});

for(const table of [false,true])test(`native deletion survives delayed metadata and generation repaint (${table?'table':'detail'})`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  await page.evaluate(table=>window.renderFixture({table}),table);
  const editor=page.getByRole('textbox');await editor.waitFor();await editor.click();await page.keyboard.press('Control+End');await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
  assert(!await editor.innerText().then(value=>value.includes('测试')));
  // The parent's source echo intentionally remains old while a query/adoption finishes.
  await page.evaluate(()=>window.renderFixture({values:{damage:{label:'40% Power'}},pending:true,refreshRevision:1}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(!await editor.innerText().then(value=>value.includes('测试')));
  await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),source.slice(0,-2));
  await page.evaluate(source=>window.renderFixture({source,pending:false}),source.slice(0,-2));
  // External metadata is no longer a display authority; the stored body remains 30%.
  await page.waitForFunction(()=>document.querySelector('[role="textbox"]').textContent.includes('30% Power'));
  assert(!await editor.innerText().then(value=>value.includes('测试')));
 }finally{await browser.close();}
});

test('explicit adoption preserves readable paired text in a focused draft',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  const editor=page.getByRole('textbox');await editor.waitFor();
  await editor.click();
  // Select only the coefficient inside the existing chip. fill(span) selects
  // the entire inherited contenteditable range and lets Chromium replace the
  // span itself, which is an unbound replacement rather than a bound-label edit.
  await page.evaluate(()=>{const text=document.querySelector('[data-template-ref="damage"]').firstChild;const range=document.createRange();range.setStart(text,1);range.setEnd(text,3);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
  await page.keyboard.type('40');
  assert.equal(await editor.locator('[data-template-ref="damage"]').count(),1);
  const paired=await page.evaluate(()=>window.changes.at(-1));assert.match(paired,/<value ref="damage">40% Power<\/value>/);
  // The parent acknowledges the draft while focus still prevents DOM replacement.
  await page.evaluate(source=>window.renderFixture({source}),paired);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Generation deliberately reuses bytes that preceded this edit, with a new adoption.
  const generatedSource=source.replace('30% Power','40% Power');
  await page.evaluate(source=>window.renderFixture({source,refreshRevision:1}),generatedSource);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator('#outside').click();
  await page.waitForFunction(()=>document.querySelector('[data-template-ref="damage"]').textContent.includes('40% Power'));
  assert.match(await editor.innerText(),/40% Power/);
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('!');await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),generatedSource+'!');
 }finally{await browser.close();}
});

for(const selectContents of ['container','contents','characters'])test(`effect boundaries survive native editing, clipboard move (${selectContents}), undo, reopen and adoption`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  const scoped='<effect ref="damage">'+source+'</effect> Independent.';
  await page.evaluate(source=>window.renderFixture({source}),scoped);
  const editor=page.getByRole('textbox');await editor.waitFor();
  const fragment=editor.locator('[data-template-effect="damage"]');await fragment.waitFor();assert(!await editor.innerText().then(x=>x.includes('<effect')));
  // Native input inside a text node retains the enclosing semantic container.
  await page.evaluate(()=>{const node=document.querySelector('[data-template-effect]').firstChild;const r=document.createRange();r.setStart(node,2);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.type('X');await page.locator('#outside').click();
  const edited=await page.evaluate(()=>window.changes.at(-1));assert(edited.startsWith('<effect ref="damage">DeXal'));assert(edited.includes('</effect> Independent.'));
  await page.evaluate(source=>window.renderFixture({source}),edited);
  // Partial cross-boundary selections are rejected explicitly rather than losing scope.
  const rejected=await page.evaluate(()=>{const element=document.querySelector('[role="textbox"]'),node=element.querySelector('[data-template-effect]').firstChild;const r=document.createRange();r.setStart(node,1);r.setEnd(element.lastChild,4);getSelection().removeAllRanges();getSelection().addRange(r);const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('application/x-inline-template');});
  assert.equal(rejected,'');await page.getByRole('status').waitFor();
  // Cut a complete container and paste outside it. Browser edit commands retain undo.
  if(selectContents==='characters'){await editor.click();await page.keyboard.press('Control+Home');const count=(await fragment.textContent()).length;for(let i=0;i<count;i++)await page.keyboard.press('Shift+ArrowRight');}
  const moved=await page.evaluate(selectContents=>{const element=document.querySelector('[role="textbox"]'),effect=element.querySelector('[data-template-effect]'),r=document.createRange();if(selectContents!=='characters'){if(selectContents==='contents')r.selectNodeContents(effect);else r.selectNode(effect);getSelection().removeAllRanges();getSelection().addRange(r);}const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));const copied=JSON.parse(data.getData('application/x-inline-template'));if(!copied.source.startsWith('<effect'))throw new Error('copy lost boundary');element.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));const end=document.createRange();end.selectNodeContents(element);end.collapse(false);getSelection().removeAllRanges();getSelection().addRange(end);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return {payload:JSON.parse(data.getData('application/x-inline-template')),text:element.textContent};},selectContents);
  assert(moved.payload.source.startsWith('<effect ref="damage">'));await page.locator('#outside').click();
  const saved=await page.evaluate(()=>window.changes.at(-1));assert(saved.startsWith(' Independent.<effect ref="damage">'));assert(saved.endsWith('</effect>'));
  await editor.focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await page.locator('#outside').click();
  assert((await page.evaluate(()=>window.changes.at(-1))).startsWith('<effect ref="damage">'));
  // A fresh identity models reopening stored source; explicit adoption keeps scope.
  await page.evaluate(source=>window.renderFixture({identity:'fixture:reopened:copy:en',source,refreshRevision:2}),saved);
  await page.waitForFunction(()=>document.querySelector('[role="textbox"]').textContent.startsWith(' Independent.'));
  assert.equal(await fragment.count(),1);
  await page.evaluate(()=>{const effect=document.querySelector('[data-template-effect]'),r=document.createRange();r.selectNode(effect);getSelection().removeAllRanges();getSelection().addRange(r);});
  await page.keyboard.press('Backspace');await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),' Independent.');
 }finally{await browser.close();}
});

test('encoded literal markup cannot become a control tag on edit/save/reopen',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  const source='&lt;effect ref=&quot;damage&quot;&gt;literal&lt;/effect&gt;.';
  await page.evaluate(source=>window.renderFixture({source}),source);const editor=page.getByRole('textbox');await editor.waitFor();
  assert.equal(await editor.locator('[data-template-effect]').count(),0);await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('!');await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),source+'!');
  await page.evaluate(source=>window.renderFixture({identity:'fixture:literal:copy:en',source}),source+'!');
  assert.equal(await editor.locator('[data-template-effect]').count(),0);
  const copied=await page.evaluate(()=>{const element=document.querySelector('[role="textbox"]'),literal=element.querySelector('[data-template-literal]');const text=literal.firstChild,r=document.createRange();r.setStart(text,0);r.setEnd(text,text.textContent.length-1);getSelection().removeAllRanges();getSelection().addRange(r);const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));const source=JSON.parse(data.getData('application/x-inline-template')).source;const end=document.createRange();end.selectNodeContents(element);end.collapse(false);getSelection().removeAllRanges();getSelection().addRange(end);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return source;});
  assert(copied.startsWith('&lt;effect'));assert.equal(await editor.locator('[data-template-effect]').count(),0);
  await page.locator('#outside').click();assert(!(await page.evaluate(()=>window.changes.at(-1))).includes('<effect'));
 }finally{await browser.close();}
});

for(const mode of ['contents','characters'])test(`nested inner effect copy/cut is rejected and complete cost retains both scopes (${mode})`,async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  const block='<cost><effect ref="damage">'+source+'</effect></cost>',original='Main. '+block;
  await page.evaluate(source=>window.renderFixture({source}),original);const editor=page.getByRole('textbox');await editor.waitFor();await editor.focus();
  const result=await page.evaluate(({mode,block})=>{
   const element=document.querySelector('[role="textbox"]'),effect=element.querySelector('[data-template-effect]');
   const range=document.createRange();range.selectNodeContents(effect);
   if(mode==='characters'){range.setStart(effect.firstChild,0);range.setEnd(effect.lastChild,effect.lastChild.textContent.length);}
   getSelection().removeAllRanges();getSelection().addRange(range);
   const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
   if(data.getData('application/x-inline-template'))throw new Error('inner scope copy must be rejected');
   element.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));
   if(element.querySelectorAll('[data-template-section], [data-template-effect]').length!==2)throw new Error('rejected cut changed source');
   const outer=document.createRange();outer.selectNode(element.querySelector('[data-template-section]'));getSelection().removeAllRanges();getSelection().addRange(outer);
   element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
   const copy=JSON.parse(data.getData('application/x-inline-template')).source;
   element.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));
   const remaining=element.textContent,cutHtml=element.innerHTML;
   const end=document.createRange();end.selectNodeContents(element);end.collapse(false);getSelection().removeAllRanges();getSelection().addRange(end);
   element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   return {copy,remaining,cutHtml,pastedHtml:element.innerHTML};
  },{mode,block});
  assert.equal(result.copy,block);assert.equal(result.remaining,'Main. ');
  await page.locator('#outside').click();assert.equal(await page.evaluate(()=>window.changes.at(-1)),original,JSON.stringify(result));
  await editor.focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),original);
  await page.evaluate(source=>window.renderFixture({identity:'fixture:cost:reopen:en',source}),original);
  await page.waitForFunction(()=>document.querySelector('[data-template-section="cost"] [data-template-effect]'));
  await editor.focus();await page.keyboard.press('Control+End');await page.keyboard.type('!');await page.locator('#outside').click();
  assert.equal(await page.evaluate(()=>window.changes.at(-1)),original.replace('</effect>','!</effect>'));
 }finally{await browser.close();}
});

test('cost containing extra text rejects partial inner-effect copy; encoded and unfinished costs save unchanged',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
  await page.evaluate(source=>window.renderFixture({source}),'Main.<cost>Extra <effect ref="damage">'+source+'</effect></cost>');const editor=page.getByRole('textbox');await editor.waitFor();
  const copied=await page.evaluate(()=>{const element=document.querySelector('[role="textbox"]'),effect=element.querySelector('[data-template-effect]'),r=document.createRange();r.selectNodeContents(effect);getSelection().removeAllRanges();getSelection().addRange(r);const data=new DataTransfer();element.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('application/x-inline-template');});
  assert.equal(copied,'');await page.getByRole('status').waitFor();
  for(const text of ['Main.&lt;cost&gt;literal&lt;/cost&gt;','Main.<cost>unfinished','Main.<cost></cost>']){
   await page.setContent('<div id="root"></div><button id="outside">Outside</button>');await page.addScriptTag({content:script});
   await page.evaluate(source=>window.renderFixture({identity:'fixture:'+source+':en',source}),text);
   await page.waitForFunction(text=>document.querySelector('[role="textbox"]').textContent===(text.endsWith('<cost></cost>')?'Main.':text.includes('&lt;')?text.replaceAll('&lt;','<').replaceAll('&gt;','>'):text),text);
   if(!text.endsWith('<cost></cost>'))await page.waitForFunction(()=>!document.querySelector('[data-template-section]'));
   await editor.focus();await page.keyboard.press('Control+Home');await page.keyboard.type('!');await page.locator('#outside').click();
   assert.equal(await page.evaluate(()=>window.changes.at(-1)),'!'+text);
  }
 }finally{await browser.close();}
});
