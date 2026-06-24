import { promoteStableClusterSuggestion, promoteStableClusterSuggestions, writeStableClusterArtifacts } from "./promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "./stable-cluster-profiles.mjs";
const profile = stableClusterProfiles.wifi;
export const promoteStablePrefixBatch16Suggestion = (suggestion) => promoteStableClusterSuggestion(suggestion, profile);
export const promoteStreamlineStablePrefixBatch16Suggestions = (payload) => promoteStableClusterSuggestions(payload, profile);
async function writeArtifacts({ suggestionsPath, outputPath, promotedSuggestionsPath } = {}) { return writeStableClusterArtifacts({ profile, suggestionsPath, outputPath, promotedSuggestionsPath }); }
function parseCliArgs(argv){const o={suggestionsPath:"",outputPath:"",promotedSuggestionsPath:""};for(let i=2;i<argv.length;i+=1){const v=argv[i];if(v==="--output"){o.outputPath=argv[++i]??"";continue;}if(v==="--promoted-output"){o.promotedSuggestionsPath=argv[++i]??"";continue;}if(!o.suggestionsPath)o.suggestionsPath=v;}return o;}
async function main(argv){const p=parseCliArgs(argv);if(!p.suggestionsPath) throw new Error("Usage: node scripts/streamline-export/promote-streamline-stable-prefix-batch16.mjs <suggestionsPath> [--output <path>] [--promoted-output <path>]");const r=await writeArtifacts({suggestionsPath:p.suggestionsPath,outputPath:p.outputPath,promotedSuggestionsPath:p.promotedSuggestionsPath});console.log(JSON.stringify(r,null,2));}
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("promote-streamline-stable-prefix-batch16.mjs")) { main(process.argv).catch((error)=>{console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1;});}
