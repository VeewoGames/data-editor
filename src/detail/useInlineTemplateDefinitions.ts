import {useMemo} from 'react';
export type InlineTemplateDefinition={file:string;collection:string;field:string;label:string;languages:{key:string;label:string}[];tableLanguage:string|null;writePolicies?:{fields:string[];requiresFields:string[];rowSelector?:{primaryKeyField:string;values:Array<string|number>}}[]};
// The document open owns this required configuration read. Project/collection
// projection is pure and cannot silently become an unconfigured editor on error.
export function useInlineTemplateDefinitions(projectId:string|null,path:string|null,collection:string,source:{projectId:string|null;templates:InlineTemplateDefinition[]}|null){
 return useMemo(()=>source?.projectId===projectId ? source.templates.filter(item=>item.file===path&&item.collection===collection) : [],[projectId,path,collection,source]);
}
