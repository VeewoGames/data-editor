import path from 'node:path';
import crypto from 'node:crypto';
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const authorityError=code=>{throw Object.assign(new Error(code),{code,status:409});};
export const normalize=file=>{const p=path.resolve(file).replaceAll('\\','/');return process.platform==='win32'?p.toLowerCase():p;};
export const exact=(v,keys)=>!!v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
export const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export const safePath=p=>typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.includes(':')&&!p.includes('\0')&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 authorityError('HISTORY_AUTHORITY_ENCODING_INVALID');
}
export const encode=value=>Buffer.from(canonical(value)+'\n');
export function decode(bytes){let v;try{v=JSON.parse(bytes);}catch{authorityError('HISTORY_AUTHORITY_SCHEMA_INVALID');}if(!encode(v).equals(Buffer.from(bytes)))authorityError('HISTORY_AUTHORITY_ENCODING_INVALID');return v;}
export function assertRef(r){if(!exact(r,'path,digest')||!hash(r.digest)||r.path!==`objects/${r.digest}.blob`)authorityError('HISTORY_AUTHORITY_REF_INVALID');}
export function assertIntent(v){
 if(!exact(v,'version,contract,root,runtime,anchorId,generation,minReaderProtocol,packageRef,policyRef')||v.version!==2||v.contract!=='history-selection-intent-v2'||!integer(v.generation)||v.generation===0||![2,3].includes(v.minReaderProtocol)||typeof v.root!=='string'||!path.isAbsolute(v.root)||normalize(v.root)!==v.root||typeof v.runtime!=='string'||normalize(v.runtime)!==v.runtime||!v.runtime.startsWith(v.root+'/')||typeof v.anchorId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v.anchorId))authorityError('HISTORY_AUTHORITY_INTENT_INVALID');assertRef(v.packageRef);assertRef(v.policyRef);
}
export function assertCatalog(v){
 if(!exact(v,'version,contract,generation,minReaderProtocol,entries')||v.version!==2||v.contract!=='history-authority-catalog-v2'||!integer(v.generation)||![2,3].includes(v.minReaderProtocol)||!Array.isArray(v.entries))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');
 const roots=[];for(const e of v.entries){if(!exact(e,'intent,envelopeRef'))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');assertIntent(e.intent);assertRef(e.envelopeRef);if(e.intent.minReaderProtocol>v.minReaderProtocol||e.intent.generation>v.generation||roots.some(r=>r===e.intent.root||r.startsWith(e.intent.root+'/')||e.intent.root.startsWith(r+'/')))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');roots.push(e.intent.root);}
 if(roots.join('\n')!==[...roots].sort().join('\n'))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');
}
export function assertEnvelope(v,intent){
 const migration=exact(v,'version,contract,migrationId,intentDigest,sourceExpectedDigest,expectedGeneration')&&v.contract==='history-authority-migration-v2'&&intent.minReaderProtocol===2&&hash(v.sourceExpectedDigest);
 const upgrade=exact(v,'version,contract,upgradeId,intentDigest,priorCatalogDigest,priorEntryDigest,deliverySpecRef,expectedGeneration')&&v.contract==='history-authority-upgrade-v2'&&intent.minReaderProtocol===3&&hash(v.priorCatalogDigest)&&hash(v.priorEntryDigest);
 if((!migration&&!upgrade)||v.version!==2||!integer(v.expectedGeneration)||v.expectedGeneration+1!==intent.generation||v.intentDigest!==digest(encode(intent)))authorityError('HISTORY_AUTHORITY_ENVELOPE_INVALID');
 if(upgrade)assertRef(v.deliverySpecRef);
 const id=migration?v.migrationId:v.upgradeId,body={...v};delete body[migration?'migrationId':'upgradeId'];
 if(!hash(id)||id!==digest(encode(body)))authorityError('HISTORY_AUTHORITY_ENVELOPE_INVALID');
}
export function assertManifest(v){
 const migration=exact(v,'version,contract,files,sourceConfigRef,sourceSnapshotRef,sourceCertificateRef,ledgerRef,targetPolicyRef')&&v.contract==='history-proof-package-v2';
 const upgrade=exact(v,'version,contract,files,priorCatalogRef,priorEntryDigest,priorPolicyObjects,ledgerRef,targetPolicyRef,deliverySpecRef')&&v.contract==='history-upgrade-proof-package-v2'&&hash(v.priorEntryDigest)&&Array.isArray(v.priorPolicyObjects);
 if((!migration&&!upgrade)||v.version!==2||!Array.isArray(v.files)||!v.files.length)authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');
 const byPath=new Map();for(const file of v.files){if(!exact(file,'path,digest,size')||!integer(file.size))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');assertRef({path:file.path,digest:file.digest});if(byPath.has(file.path))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');byPath.set(file.path,file);}
 const names=migration?['sourceConfigRef','ledgerRef','targetPolicyRef','sourceSnapshotRef','sourceCertificateRef']:['priorCatalogRef','ledgerRef','targetPolicyRef','deliverySpecRef'];
 for(const name of names){const ref=v[name];if(ref===null&&['sourceSnapshotRef','sourceCertificateRef'].includes(name))continue;assertRef(ref);if(byPath.get(ref.path)?.digest!==ref.digest)authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');}
 if(migration&&(v.sourceSnapshotRef===null)!==(v.sourceCertificateRef===null))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');
 if(upgrade){const seen=new Set();for(const pin of v.priorPolicyObjects){if(!exact(pin,'path,digest,size')||!safePath(pin.path)||!hash(pin.digest)||!integer(pin.size)||seen.has(pin.path.toLowerCase())||byPath.get('objects/'+pin.digest+'.blob')?.size!==pin.size)authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');seen.add(pin.path.toLowerCase());}}
}
export function assertPolicy(p){
 if(!exact(p,'contract,businessFiles,deploymentFiles')||p.contract!=='managed-entry-non-replay-v1'||!Array.isArray(p.businessFiles)||!p.businessFiles.length||!Array.isArray(p.deploymentFiles)||!p.deploymentFiles.length||p.businessFiles.some(f=>!safePath(f))||new Set(p.businessFiles).size!==p.businessFiles.length)authorityError('HISTORY_MANAGED_POLICY_REQUIRED');
 const seen=new Set();for(const f of p.deploymentFiles){if(!exact(f,'path,digest')||!safePath(f.path)||!hash(f.digest)||seen.has(f.path.toLowerCase()))authorityError('HISTORY_MANAGED_POLICY_REQUIRED');seen.add(f.path.toLowerCase());}
}
