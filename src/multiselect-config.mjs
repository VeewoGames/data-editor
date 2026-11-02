import {prepareCellWritesByRowId,captureCellWriteTarget,validateCellWriteTarget} from './model/writeback-adapter.mjs';
import {getRows} from './document-model.mjs';

function optionReadSignature(value, mode) {
  if(mode==='multi')return Array.isArray(value)?JSON.stringify(value.map(item=>[typeof item,String(item)])):'skip';
  return value==null||Array.isArray(value)||typeof value==='object'?'skip':JSON.stringify([typeof value,String(value)]);
}

function captureOptionColumn({model,store,collectionPath,fieldName,mode}) {
  const root=model.root,map=collectionPath==='$'&&model.rootCollectionKind==='record-map',container=map?root:getRows(model,collectionPath),collection=store.collections.get(collectionPath);
  const readEntries=()=>map?Object.keys(root).map(key=>({key,source:Object.getOwnPropertyDescriptor(root,key)?.value})):container.map((source,key)=>({key,source}));
  const readValue=entry=>{
    if(map&&fieldName===model.rootKeyField)return entry.key;
    if(entry.source===null||typeof entry.source!=='object'||Array.isArray(entry.source))return undefined;
    const descriptor=Object.getOwnPropertyDescriptor(entry.source,fieldName);
    if(descriptor&&!('value' in descriptor))throw new Error('Option column contains a non-data property');
    return descriptor?.value;
  };
  const before=readEntries().map(entry=>({...entry,signature:optionReadSignature(readValue(entry),mode)}));
  if(before.length!==collection.rowViews.length||before.some((entry,index)=>{const handle=collection.handleById.get(collection.rowViews[index]?.rowId);return !handle||!Object.is(entry.source,handle.sourceValue)||(map?handle.sourceKey!==entry.key:handle.sourceIndex!==entry.key)}))throw new Error('Option collection no longer matches the store');
  let after=before;
  const assert=expected=>{
    if(model.root!==root||(!map&&getRows(model,collectionPath)!==container))throw new Error('Option collection changed');
    const actual=readEntries();
    if(actual.length!==expected.length||actual.some((entry,i)=>entry.key!==expected[i].key||!Object.is(entry.source,expected[i].source)||optionReadSignature(readValue(entry),mode)!==expected[i].signature))throw new Error('Option collection changed');
  };
  return {
    before(){assert(before)},after(){assert(after)},
    expect(writes){
      const nextBySource=new Map(writes.filter(write=>!write.witnessOnly).map(write=>[write.target.expectedSource,write.value]));
      after=before.map(entry=>{
        if(!nextBySource.has(entry.source))return entry;
        const next=nextBySource.get(entry.source),key=map&&fieldName===model.rootKeyField?String(next??'').trim():entry.key;
        return {key,source:entry.source,signature:optionReadSignature(map&&fieldName===model.rootKeyField?key:next,mode)};
      });
      if(map&&fieldName===model.rootKeyField){const ordered=Object.fromEntries(after.map(entry=>[entry.key,entry]));after=Object.keys(ordered).map(key=>ordered[key]);}
    },
  };
}

function guardOptionColumn(plan,column) {
  let partial=false;
  return {
    get changed(){return plan.changed},get state(){return partial?'partial':plan.state},
    assertApplied(){plan.assertApplied();column.after()},
    assertPrepared(){column.before();plan.assertPrepared()},
    apply(){
      column.before();plan.apply();
      try{column.after()}catch(cause){
        try{plan.rollback()}catch(rollbackError){partial=true;throw Object.assign(new Error('Option write rollback failed',{cause}),{code:'DOCUMENT_WRITE_ROLLBACK_FAILED',rollbackError})}
        throw Object.assign(new Error('Option collection changed during commit',{cause}),{code:'OPTION_FIELD_CONCURRENT_CHANGE',rollbackSucceeded:true});
      }
    },
    rollback(){plan.rollback()},
  };
}

export function prepareOptionFieldWrites({model,store,collectionPath,target:captured,mode,patch}) {
  const primitive = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (!['single','multi'].includes(mode) || !patch || typeof patch.valueChanged!=='boolean' || !Array.isArray(patch.nextSelectedValues) || patch.nextSelectedValues.some(value => !primitive(value)) || (mode === 'single' && patch.nextSelectedValues.length > 1) || !Array.isArray(patch.renamedOptions) || !Array.isArray(patch.deletedOptionValues) || patch.deletedOptionValues.some(value => !primitive(value)) || patch.renamedOptions.some(rename => !rename || !primitive(rename.previousValue) || !primitive(rename.nextValue))) throw new Error('Invalid option field patch');
  validateCellWriteTarget({model,store,collectionPath,target:captured});
  const {rowId,fieldName}=captured,collection=store.collections.get(collectionPath),target=collection.handleById.get(rowId);
  const currentValue=collectionPath==='$'&&model.rootCollectionKind==='record-map'&&fieldName===model.rootKeyField?target.sourceKey:target.sourceValue[fieldName];
  if(mode==='multi'?!Array.isArray(currentValue)||currentValue.some(value=>!primitive(value)):currentValue!=null&&!primitive(currentValue))throw new Error('Current value is not compatible with the option field');
  const selected=mode==='multi'?currentValue:currentValue==null||currentValue===''?[]:[currentValue];
  if(!patch.valueChanged&&JSON.stringify(selected.map(value=>JSON.stringify(value)).sort())!==JSON.stringify(patch.nextSelectedValues.map(value=>JSON.stringify(value)).sort()))throw new Error('Option selection change flag does not match the captured value');
  const finalValue=mode==='single'?(patch.nextSelectedValues[0]??null):patch.nextSelectedValues;
  const bulk=patch.renamedOptions.length>0||patch.deletedOptionValues.length>0;
  const writes=[];
  const sameValue=(a,b)=>Object.is(a,b)||(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index])));
  const compatible=value=>mode==='multi'?Array.isArray(value)&&value.every(primitive):value==null||primitive(value);
  let column=null;
  if (bulk) {
    column=captureOptionColumn({model,store,collectionPath,fieldName,mode});
    const handles=[...collection.handleById.values()].filter(handle=>handle.sourceValue!==null&&typeof handle.sourceValue==='object'&&!Array.isArray(handle.sourceValue));
    const original=handles.map(handle=>collectionPath==='$'&&model.rootCollectionKind==='record-map'&&fieldName===model.rootKeyField?handle.sourceKey:handle.sourceValue[fieldName]);
    const shadow=original.map(value=>({[fieldName]:value}));
    for (const rename of patch.renamedOptions) (mode==='single'?renameSingleSelectOptionInRows:renameMultiSelectOptionInRows)(shadow,fieldName,rename.previousValue,rename.nextValue);
    for (const value of patch.deletedOptionValues) (mode==='single'?removeSingleSelectOptionFromRows:removeMultiSelectOptionFromRows)(shadow,fieldName,value);
    for (let i=0;i<handles.length;i++) {
      const next=handles[i].rowId===rowId&&patch.valueChanged?finalValue:shadow[i][fieldName],unchanged=sameValue(next,original[i]);
      if(!unchanged&&!compatible(original[i]))throw new Error('Affected value is not compatible with the option field');
      if(!unchanged||handles[i].rowId===rowId)writes.push({target:handles[i].rowId===rowId?captured:captureCellWriteTarget({model,store,collectionPath,rowId:handles[i].rowId,fieldName}),value:next,witnessOnly:unchanged});
    }
    column.before();column.expect(writes);
  } else writes.push({target:captured,value:patch.valueChanged?finalValue:currentValue,witnessOnly:!patch.valueChanged});
  const plan=prepareCellWritesByRowId({model,store,collectionPath,writes});
  return column?guardOptionColumn(plan,column):plan;
}

export function renameMultiSelectOptionInRows(rows, fieldName, previousValue, nextValue) {
  const from = String(previousValue);
  const to = String(nextValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    row[fieldName] = value.map((item) => String(item) === from ? castLike(item, to) : item);
  }
}

export function renameSingleSelectOptionInRows(rows, fieldName, previousValue, nextValue) {
  const from = String(previousValue);
  const to = String(nextValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (value == null || Array.isArray(value) || typeof value === "object") continue;
    if (String(value) === from) row[fieldName] = castLike(value, to);
  }
}

export function removeMultiSelectOptionFromRows(rows, fieldName, optionValue) {
  const target = String(optionValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    row[fieldName] = value.filter((item) => String(item) !== target);
  }
}

export function removeSingleSelectOptionFromRows(rows, fieldName, optionValue) {
  const target = String(optionValue);
  for (const row of rows) {
    const value = row?.[fieldName];
    if (value == null || Array.isArray(value) || typeof value === "object") continue;
    if (String(value) === target) row[fieldName] = null;
  }
}

export function buildMultiSelectFieldConfig(discoveredOptions, storedFieldConfig) {
  const storedOptions = storedFieldConfig?.multiSelectOptions ?? {};
  const dataValues = new Map();
  const ambiguous = new Set();
  for (const value of discoveredOptions) {
    const key = String(value);
    if (dataValues.has(key) && dataValues.get(key) !== value) ambiguous.add(key);
    else dataValues.set(key, value);
  }
  const orderedValues = [...new Set([
    ...Object.keys(storedOptions),
    ...discoveredOptions.map((value) => String(value)),
  ])];
  const options = orderedValues.map((value) => {
    const stored = normalizeOptionDataValue(value, storedOptions[value]?.dataValue);
    const observed = dataValues.has(value) ? dataValues.get(value) : stored.dataValue;
    const typed = typeof observed === "number" || stored.dataValue !== undefined ? { dataValue: observed } : {};
    return {
      value,
      ...(ambiguous.has(value) ? { dataValueAmbiguous: true } : typed),
      ...(typed.dataValue !== undefined && typed.dataValue !== stored.dataValue ? { dataValueNeedsPersistence: true } : {}),
      label: storedOptions[value]?.label ?? value,
      color: storedOptions[value]?.color ?? null,
    };
  });
  return {
    options,
    optionMap: Object.fromEntries(options.map((option) => [option.value, option])),
  };
}

// UI keys are strings, but a key must never decide the type written to JSON.
export function resolveOptionDataValue(value, options) {
  const option = options.find(option => option.value === String(value));
  if (option?.dataValueAmbiguous) return undefined;
  return option?.dataValue ?? value;
}

export function normalizeOptionDataValue(key, value) {
  return ((typeof value === "number" && Number.isFinite(value)) || typeof value === "string") && String(value) === key
    ? { dataValue: value } : {};
}

export function buildSchemaOptionViews(options = []) {
  const config = buildMultiSelectFieldConfig(options.map(option => option.value));
  return config.options.map(option => ({
    ...option,
    label: options.find(source => String(source.value) === option.value)?.label ?? option.label,
    dataValueNeedsPersistence: false, // The schema remains the explicit source, including when every cell is empty.
  }));
}

export function buildSingleSelectFieldConfigFromRows(rows, fieldName, storedFieldConfig) {
  const values = rows.map(row => row[fieldName]).filter(value => typeof value === "string" || typeof value === "number");
  return buildMultiSelectFieldConfig(values, { multiSelectOptions: storedFieldConfig?.selectOptions });
}

export function buildMultiSelectFieldConfigFromRows(rows, fieldName, storedFieldConfig) {
  const values = [];
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item == null || (typeof item !== "string" && typeof item !== "number")) continue;
      values.push(item);
    }
  }
  return buildMultiSelectFieldConfig(values, storedFieldConfig);
}

export function sortValuesByOptionOrder(values, orderedOptionValues) {
  const orderIndex = new Map(orderedOptionValues.map((value, index) => [String(value), index]));
  return [...values].sort((left, right) => {
    const leftKey = String(left);
    const rightKey = String(right);
    const leftIndex = orderIndex.get(leftKey);
    const rightIndex = orderIndex.get(rightKey);
    if (leftIndex == null && rightIndex == null) return 0;
    if (leftIndex == null) return 1;
    if (rightIndex == null) return -1;
    return leftIndex - rightIndex;
  });
}

export function buildOptionConfigByOrder(optionConfig, orderedValues) {
  const nextConfig = {};
  const seen = new Set();
  for (const value of orderedValues) {
    const key = String(value);
    if (seen.has(key)) continue;
    const config = optionConfig[key];
    nextConfig[key] = config ?? { label: key, color: null };
    seen.add(key);
  }
  for (const [key, config] of Object.entries(optionConfig)) {
    if (seen.has(key)) continue;
    nextConfig[key] = config;
  }
  return nextConfig;
}

export function buildOptionConfigFromOptions(options) {
  const nextConfig = {};
  for (const option of options) {
    const key = String(option.value);
    nextConfig[key] = {
      label: option.label ?? key,
      color: option.color ?? null,
      ...(option.dataValueAmbiguous ? {} : normalizeOptionDataValue(key, option.dataValue)),
    };
  }
  return nextConfig;
}

export function renameOptionConfigValue(optionConfig, previousValue, nextValue, fallbackColor = null) {
  const nextConfig = {};
  const fromKey = String(previousValue);
  const toKey = String(nextValue);
  for (const [key, config] of Object.entries(optionConfig)) {
    if (key === fromKey) {
      nextConfig[toKey] = {
        label: toKey,
        color: config?.color ?? fallbackColor,
      };
      continue;
    }
    nextConfig[key] = config;
  }
  if (!nextConfig[toKey]) {
    nextConfig[toKey] = { label: toKey, color: fallbackColor };
  }
  return nextConfig;
}

function castLike(previousValue, nextValue) {
  if (typeof previousValue === "number" && /^-?\d+(\.\d+)?$/.test(nextValue)) return Number(nextValue);
  return nextValue;
}
