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
 if(!exact(v,'version,contract,root,runtime,anchorId,generation,minReaderProtocol,packageRef,policyRef')||v.version!==2||v.contract!=='history-selection-intent-v2'||!integer(v.generation)||v.generation===0||v.minReaderProtocol!==2||typeof v.root!=='string'||!path.isAbsolute(v.root)||normalize(v.root)!==v.root||typeof v.runtime!=='string'||normalize(v.runtime)!==v.runtime||!v.runtime.startsWith(v.root+'/')||typeof v.anchorId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(v.anchorId))authorityError('HISTORY_AUTHORITY_INTENT_INVALID');assertRef(v.packageRef);assertRef(v.policyRef);
}
export function assertCatalog(v){
 if(!exact(v,'version,contract,generation,minReaderProtocol,entries')||v.version!==2||v.contract!=='history-authority-catalog-v2'||!integer(v.generation)||v.minReaderProtocol!==2||!Array.isArray(v.entries))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');
 const roots=[];for(const e of v.entries){if(!exact(e,'intent,envelopeRef'))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');assertIntent(e.intent);assertRef(e.envelopeRef);if(e.intent.generation>v.generation||roots.some(r=>r===e.intent.root||r.startsWith(e.intent.root+'/')||e.intent.root.startsWith(r+'/')))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');roots.push(e.intent.root);}
 if(roots.join('\n')!==[...roots].sort().join('\n'))authorityError('HISTORY_AUTHORITY_CATALOG_INVALID');
}
export function assertEnvelope(v,intent){
 if(!exact(v,'version,contract,migrationId,intentDigest,sourceExpectedDigest,expectedGeneration')||v.version!==2||v.contract!=='history-authority-migration-v2'||!hash(v.migrationId)||!hash(v.sourceExpectedDigest)||!integer(v.expectedGeneration)||v.expectedGeneration+1!==intent.generation||v.intentDigest!==digest(encode(intent)))authorityError('HISTORY_AUTHORITY_ENVELOPE_INVALID');
 const {migrationId,...body}=v;if(migrationId!==digest(encode(body)))authorityError('HISTORY_AUTHORITY_ENVELOPE_INVALID');
}
export function assertManifest(v){
 if(!exact(v,'version,contract,files,sourceConfigRef,sourceSnapshotRef,sourceCertificateRef,ledgerRef,targetPolicyRef')||v.version!==2||v.contract!=='history-proof-package-v2'||!Array.isArray(v.files)||!v.files.length)authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');
 const byPath=new Map();for(const f of v.files){if(!exact(f,'path,digest,size')||!integer(f.size))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');assertRef({path:f.path,digest:f.digest});if(byPath.has(f.path))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');byPath.set(f.path,f);}
 for(const name of ['sourceConfigRef','ledgerRef','targetPolicyRef','sourceSnapshotRef','sourceCertificateRef']){const r=v[name];if(r===null&&['sourceSnapshotRef','sourceCertificateRef'].includes(name))continue;assertRef(r);if(byPath.get(r.path)?.digest!==r.digest)authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');}
 if((v.sourceSnapshotRef===null)!==(v.sourceCertificateRef===null))authorityError('HISTORY_AUTHORITY_PACKAGE_INVALID');
}
export function assertPolicy(p){
 if(!exact(p,'contract,businessFiles,deploymentFiles')||p.contract!=='managed-entry-non-replay-v1'||!Array.isArray(p.businessFiles)||!p.businessFiles.length||!Array.isArray(p.deploymentFiles)||!p.deploymentFiles.length||p.businessFiles.some(f=>!safePath(f))||new Set(p.businessFiles).size!==p.businessFiles.length)authorityError('HISTORY_MANAGED_POLICY_REQUIRED');
 const seen=new Set();for(const f of p.deploymentFiles){if(!exact(f,'path,digest')||!safePath(f.path)||!hash(f.digest)||seen.has(f.path.toLowerCase()))authorityError('HISTORY_MANAGED_POLICY_REQUIRED');seen.add(f.path.toLowerCase());}
}
