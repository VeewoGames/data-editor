import { useEffect, useState } from 'react';
export type InlineTemplateDefinition={file:string;collection:string;field:string;label:string;languages:{key:string;label:string}[];tableLanguage:string|null;writePolicies?:{fields:string[];requiresFields:string[]}[];advancedFields:string[]};
export function useInlineTemplateDefinitions(projectId:string|null,path:string|null,collection:string){
 const scope=JSON.stringify([projectId,path,collection]);
 const [state,setState]=useState<{scope:string;items:InlineTemplateDefinition[]}>();
 useEffect(()=>{let stale=false;if(!projectId||!path)return;fetch(`/api/inline-template-definitions?${new URLSearchParams({projectId})}`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('描述编辑配置不可用');return r.json();}).then(result=>{if(!stale)setState({scope,items:result.templates.filter((item:InlineTemplateDefinition)=>item.file===path&&item.collection===collection)});}).catch(()=>{if(!stale)setState({scope,items:[]});});return()=>{stale=true;};},[scope]);
 return state?.scope===scope?state.items:EMPTY;
}
const EMPTY:InlineTemplateDefinition[]=[];
