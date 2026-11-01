import assert from "node:assert/strict";
import test from "node:test";
import { buildVariableRowWindow, createRowHeightIndex, captureRowAnchor, restoreRowAnchor } from "../src/table/variable-row-window.mjs";

test("buildVariableRowWindow returns a bounded window for uniform heights", () => {
  const rowIds = Array.from({ length: 100 }, (_, index) => `row-${index}`);
  const result = buildVariableRowWindow({
    index: createRowHeightIndex(rowIds, () => 36),
    viewportHeight: 72,
    scrollTop: 72,
    overscan: 1,
    getRowHeight: () => 36,
  });

  assert.deepEqual(result, {
    windowStart: 1,
    windowEnd: 5,
    topSpacerHeight: 36,
    bottomSpacerHeight: 3420,
    totalHeight: 3600,
  });
});

test("buildVariableRowWindow handles mixed heights and preserves spacer totals", () => {
  const rowIds = ["a", "b", "c", "d", "e"];
  const heights = { a: 50, b: 70, c: 90, d: 110, e: 130 };
  const result = buildVariableRowWindow({
    index: createRowHeightIndex(rowIds, rowId => heights[rowId]),
    viewportHeight: 120,
    scrollTop: 130,
    overscan: 1,
    getRowHeight: (rowId) => heights[rowId],
  });

  assert.equal(result.windowStart, 1);
  assert.equal(result.windowEnd, 5);
  assert.equal(result.topSpacerHeight, 50);
  assert.equal(result.bottomSpacerHeight, 0);
  assert.equal(result.totalHeight, 450);
});

test('offset windows match a linear oracle after mixed point updates',()=>{const ids=Array.from({length:513},(_,i)=>'r'+i),heights=ids.map((_,i)=>17+(i*31)%129),index=createRowHeightIndex(ids,(_,i)=>heights[i]);for(let pass=0;pass<100;pass++){const at=pass*37%ids.length;heights[at]=25+pass%91;index.update(ids[at],heights[at]);const total=heights.reduce((a,b)=>a+b,0),top=Math.min(pass*733%total,Math.max(0,total-237)),bottom=top+237;let start=0,sum=0;while(start<ids.length&&sum+heights[start]<=top)sum+=heights[start++];let end=start;while(end<ids.length&&sum<bottom)sum+=heights[end++];const result=buildVariableRowWindow({index,scrollTop:top,viewportHeight:237,overscan:3});assert.equal(result.windowStart,Math.max(0,start-3));assert.equal(result.windowEnd,Math.min(ids.length,end+3));assert.equal(result.topSpacerHeight,heights.slice(0,result.windowStart).reduce((a,b)=>a+b,0));assert.equal(result.bottomSpacerHeight,total-heights.slice(0,result.windowEnd).reduce((a,b)=>a+b,0));}});

test('deep scrolling and height updates visit logarithmic tree nodes without reading all rows',()=>{let reads=0;const ids=Array.from({length:100000},(_,i)=>'r'+i),index=createRowHeightIndex(ids,()=>{reads++;return 40;});assert.equal(reads,100000);index.takeVisitCount();for(let i=0;i<1000;i++){buildVariableRowWindow({index,scrollTop:3000000+i,viewportHeight:800,overscan:5});index.update('r'+(i*73),41);}assert.equal(reads,100000);assert.ok(index.takeVisitCount()<150000);});

test('anchors retain identity and inner offset across measurements order changes and removed rows',()=>{const old=createRowHeightIndex(['a','b','c','d'],()=>40),anchor=captureRowAnchor(old,55);old.update('a',90);assert.equal(restoreRowAnchor(old,old,anchor),105);const reordered=createRowHeightIndex(['d','b','a'],()=>50);assert.equal(restoreRowAnchor(old,reordered,anchor),65);const removed=createRowHeightIndex(['d','a'],()=>50);assert.equal(restoreRowAnchor(old,removed,anchor),15);assert.equal(restoreRowAnchor(old,createRowHeightIndex([],()=>40),anchor),0);});

test('unchanged measurements do not traverse or copy stored heights',()=>{const index=createRowHeightIndex(Array.from({length:100000},(_,i)=>'r'+i),()=>50);index.takeVisitCount();assert.equal(index.update('r9',50),false);assert.equal(index.takeVisitCount(),0);});
