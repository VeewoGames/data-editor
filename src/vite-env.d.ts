/// <reference types="vite/client" />

declare module "*.mjs" {
  const value: any;
  export default value;
  export const addField: any;
  export const addRow: any;
  export const buildDocumentModel: any;
  export const buildRelationIndex: any;
  export const buildRelationOptions: any;
  export const defaultTypeFor: any;
  export const deleteField: any;
  export const deleteRow: any;
  export const fieldTypes: any;
  export const getRelationOptionLabel: any;
  export const getByPath: any;
  export const getMainColumns: any;
  export const getNestedFields: any;
  export const getRows: any;
  export const isCompatible: any;
  export const setByPath: any;
  export const setCellValue: any;
  export const setNestedValue: any;
  export const summarizeNested: any;
  export const validateRelationValue: any;
  export const validateRequired: any;
  export const validateUnique: any;
}
