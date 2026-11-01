import {readAuthoritySnapshot,authorityPhysical} from './deployment-authority-store.mjs';
// Offline v1 input location only. Runtime never loads it or falls back to it.
export const historyPhysicalKey=file=>process.platform==='win32'?file.replaceAll('\\','/').toLowerCase():file;
export const historyPhysicalPath=authorityPhysical;
export async function readHistoryDeployment(){const snapshot=await readAuthoritySnapshot();return snapshot.entries.map(e=>({...e,authorityStamp:snapshot.stamp}));}
