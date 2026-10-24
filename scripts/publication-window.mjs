import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createProjectContext} from '../src/project-context.mjs';
import {inspectPublicationWindow,initializePublicationWindow,closePublicationWindow,advancePublicationWindow,recoverPublicationPublisher,reconcilePublicationReservation} from '../src/publication-window-state.mjs';

// Administrative local interface: explicit project and request file, no default
// project, automatic provisioning, copying, recovery or production activation.
const [operation,root,requestFile]=process.argv.slice(2);
if(!root||!path.isAbsolute(root)) throw Error('Explicit absolute project root is required.');
const context=createProjectContext(root);
const input=requestFile?JSON.parse(await readFile(requestFile,'utf8')):{};
const handlers={inspect:()=>inspectPublicationWindow(context),initialize:()=>initializePublicationWindow(context),close:()=>closePublicationWindow(context,input),advance:()=>advancePublicationWindow(context,input),takeover:()=>recoverPublicationPublisher(context,input),reconcile:()=>reconcilePublicationReservation(context,input)};
if(!handlers[operation])throw Error('Use inspect, initialize, close, advance or takeover.');
try{process.stdout.write(`${JSON.stringify(await handlers[operation]())}\n`);}
catch(e){process.stderr.write(`${JSON.stringify({code:e.code??'PUBLICATION_CLI_FAILED',message:e.message})}\n`);process.exitCode=1;}
