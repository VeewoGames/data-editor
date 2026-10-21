import test from 'node:test';
import assert from 'node:assert/strict';
import {readableTemplateText,projectTemplateSearchRow,keywordSourceFromDisplay} from '../src/detail/inline-template-text.mjs';
import {runSearch} from '../src/view/search-engine.mjs';

test('keyword markup is hidden in readable editing/search projection while modes remain visible',()=>{
 const raw='Apply <kw id="slow" mode="default">Slow</kw> and <kw id="stun" mode="alt">Stun</kw> for <value ref="turns">2</value> turns.';
 assert.equal(readableTemplateText(raw,{turns:{label:'2'}}),'Apply {Slow} and [Stun] for <2> turns.');
 const row={copy:{en:raw},id:'a'};const original=structuredClone(row);const projected=projectTemplateSearchRow(row,[{field:'copy'}],{copy:{en:{turns:{label:'2'}}}});
 assert.deepEqual(runSearch({rows:[{rowId:'a',sourceOrder:0,row:projected}],query:'Slow'}).searchRowIds,['a']);
 assert.deepEqual(row,original);assert(!projected.copy.includes('mode='));assert(!projected.copy.includes('<kw'));
});
test('editing keyword wording never changes the original id or mode and encodes markup',()=>{
 assert.equal(keywordSourceFromDisplay('slow','default','{Different}'),'<kw id="slow" mode="default">Different</kw>');
 assert.equal(keywordSourceFromDisplay('slow','alt','[Different]'),'<kw id="slow" mode="alt">Different</kw>');
 assert.equal(keywordSourceFromDisplay('slow','default','{<script>}'),'<kw id="slow" mode="default">&lt;script&gt;</kw>');
 assert.throws(()=>keywordSourceFromDisplay('" invalid','default','text'),/IDENTITY_INVALID/);
 assert.throws(()=>keywordSourceFromDisplay('slow','unknown','text'),/IDENTITY_INVALID/);
});
test('escaped keyword-looking literals are not interpreted as live identity markup',()=>{
 const source='&lt;kw id=&quot;slow&quot; mode=&quot;default&quot;&gt;Slow&lt;/kw&gt;';
 assert.equal(readableTemplateText(source),'<kw id="slow" mode="default">Slow</kw>');
});
test('missing author text stays diagnostic and never consumes external labels',()=>{
 const source='Deal <value ref="damage" /> damage and <kw id="slow" mode="default">Slow</kw>.';
 assert.equal(readableTemplateText(source),'Deal <缺可读源文：damage> damage and {Slow}.');
 assert.equal(readableTemplateText(source,{damage:{label:'30% Power'}}),'Deal <缺可读源文：damage> damage and {Slow}.');
 assert.equal(source,'Deal <value ref="damage" /> damage and <kw id="slow" mode="default">Slow</kw>.');
});

test('numeric body entities are decoded exactly once',()=>{
 assert.equal(readableTemplateText('<value ref="example">A &amp;lt; B</value>'),'<A &lt; B>');
});
