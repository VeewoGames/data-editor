// Offline administration only. The trust directory is always resolved by the native locator.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {prepareAuthorityImport,applyAuthorityImport,inspectAuthority,initializeEmptyAuthority,prepareAuthorityUpgrade,verifyAuthorityUpgrade,applyAuthorityUpgrade,completeAuthorityUpgrade} from '../src/deployment-authority-store.mjs';
import {encode,decode,digest,hash,authorityError as bad} from '../src/deployment-authority-schema.mjs';

export async function runAuthorityCommand(argv){
 const [command,...rest]=argv,options={};
 const bundleArgs=['--bundle','--bundle-digest'];
 const allowed={prepare:['--source-tool','--project','--output'],apply:bundleArgs,verify:[], 'init-empty':['--confirm-new-install'],'upgrade-prepare':['--installed-tool','--candidate-tool','--release-manifest','--output'],'upgrade-verify':bundleArgs,'upgrade-apply':bundleArgs,'upgrade-complete':bundleArgs};
 if(!Object.hasOwn(allowed,command))bad('HISTORY_AUTHORITY_COMMAND_INVALID');
 for(let i=0;i<rest.length;i++){
  const key=rest[i];if(!allowed[command].includes(key)||Object.hasOwn(options,key))bad('HISTORY_AUTHORITY_ARGUMENT_INVALID');
  if(key==='--confirm-new-install'){options[key]=true;continue;}
  const value=rest[++i];if(!value||value.startsWith('--'))bad('HISTORY_AUTHORITY_ARGUMENT_INVALID');options[key]=value;
 }
 if(allowed[command].some(k=>!Object.hasOwn(options,k)))bad('HISTORY_AUTHORITY_ARGUMENT_REQUIRED');
 for(const key of ['--source-tool','--project','--output','--bundle','--installed-tool','--candidate-tool','--release-manifest'])if(options[key]&&!path.isAbsolute(options[key]))bad('HISTORY_AUTHORITY_ABSOLUTE_PATH_REQUIRED');
 if(command==='verify')return inspectAuthority();
 if(command==='init-empty')return initializeEmptyAuthority();
 if(command==='prepare'||command==='upgrade-prepare'){
  const output=path.resolve(options['--output']);
  if(path.resolve(await realpath(path.dirname(output)),path.basename(output))!==output)bad('HISTORY_AUTHORITY_ALIAS_REJECTED');
  const bundle=command==='prepare'?await prepareAuthorityImport({sourceTool:options['--source-tool'],projectRoot:options['--project']}):await prepareAuthorityUpgrade({installedTool:options['--installed-tool'],candidateTool:options['--candidate-tool'],releaseManifest:JSON.parse(await readFile(options['--release-manifest'],'utf8'))}),bytes=encode(bundle);
  await writeFile(output,bytes,{flag:'wx'});
  return {status:'prepared',output,bundleDigest:digest(bytes),migrationId:bundle.migrationId,deliveryId:bundle.deliveryId,expectedCatalogDigest:bundle.expectedCatalogDigest,generation:bundle.catalog.generation};
 }
 const bytes=await readFile(options['--bundle']);
 if(!hash(options['--bundle-digest'])||digest(bytes)!==options['--bundle-digest'])bad('HISTORY_AUTHORITY_BUNDLE_DIGEST_MISMATCH');
 const bundle=decode(bytes);
 if(command==='upgrade-verify')return verifyAuthorityUpgrade(bundle);
 if(command==='upgrade-apply')return applyAuthorityUpgrade(bundle);
 if(command==='upgrade-complete')return completeAuthorityUpgrade(bundle);
 return applyAuthorityImport(bundle);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify({ok:true,...await runAuthorityCommand(process.argv.slice(2))})+'\n');}
 catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code??'HISTORY_AUTHORITY_FAILED'})+'\n');process.exitCode=2;}
}
