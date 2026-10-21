const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Reconcile server generation with drafts made after the accepted snapshot.
 * Local text remains a new unpublished draft. Server-owned outputs always come from server.
 * Structural row changes are refused rather than guessed.
 */
export function refreshCommandDocument(base, local, server, policies=[]) {
  const rules=policies.length&&typeof policies[0]==='string'?[{fields:policies,requiresFields:[]}]:policies;
  let keptDraft=false;
  function visit(before, draft, persisted, field='', inherited=new Set()) {
    const guarded=new Set(inherited);
    if(guarded.has(field))return structuredClone(persisted);
    if(equal(draft,before))return structuredClone(persisted);
    if(equal(draft,persisted))return structuredClone(persisted);
    if(Array.isArray(before)&&Array.isArray(draft)&&Array.isArray(persisted)) {
      const ids=items=>items.map(x=>x?.__entry_id);
      if(equal(ids(before),ids(draft))&&equal(ids(before),ids(persisted)) && ids(before).every(Boolean))return draft.map((x,i)=>visit(before[i],x,persisted[i],'',guarded));
      if(equal(before,persisted)){keptDraft=true;return structuredClone(draft);}
      throw new Error('COMMAND_REFRESH_STRUCTURAL_CONFLICT');
    }
    if(before&&draft&&persisted&&typeof before==='object'&&typeof draft==='object'&&typeof persisted==='object'&&!Array.isArray(before)&&!Array.isArray(draft)&&!Array.isArray(persisted)) {
      for(const rule of rules)if(rule.requiresFields.every(key=>Object.hasOwn(before,key)||Object.hasOwn(persisted,key)))for(const key of rule.fields)guarded.add(key);
      const out={};for(const key of new Set([...Object.keys(before),...Object.keys(draft),...Object.keys(persisted)])) {
        const next=visit(before[key],draft[key],persisted[key],key,guarded);if(next!==undefined)out[key]=next;
      }return out;
    }
    // A changed author field is a fresh draft, never the normalization of an older input.
    keptDraft=true;return structuredClone(draft);
  }
  return {root:visit(base,local,server),keptDraft};
}
