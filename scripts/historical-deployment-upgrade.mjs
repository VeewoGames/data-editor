// The v1 writer is retired. Original bytes remain frozen in source proof packages.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const retired=()=>{throw Object.assign(new Error('Use scripts/deployment-authority.mjs.'),{code:'HISTORY_V1_ADMIN_RETIRED',status:409});};
export const prepareDeploymentUpgrade=retired;
export const applyDeploymentUpgrade=retired;
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){process.stdout.write(JSON.stringify({ok:false,code:'HISTORY_V1_ADMIN_RETIRED'})+'\n');process.exitCode=2;}
