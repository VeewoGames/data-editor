// A fixed real-command probe. The parent freezes this file and its input spec.
import {readFileSync,writeFileSync} from 'node:fs';
const spec=JSON.parse(readFileSync(process.argv[2],'utf8'));
const readable=readFileSync(spec.readableFile,'utf8');
const attempts={};
for(const [name,file]of Object.entries(spec.targets)){
 try{writeFileSync(file,spec.payload);attempts[name]={result:'written'};}
 catch(error){attempts[name]={result:'rejected',code:error.code};}
}
const receipt={version:1,nonce:spec.nonce,pid:process.pid,cwd:process.cwd(),readable,attempts};
writeFileSync(spec.receipt,JSON.stringify(receipt)+'\n');
process.stdout.write('DATA_EDITOR_SANDBOX_PROBE '+JSON.stringify(receipt)+'\n');
