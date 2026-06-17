import type { FilterGroup, SortRule } from "../api/client";
import type { DataRecord } from "../model/documentModel";

export type CandidateRowIds = string[] | null;

export type ViewEngineRow = {
  rowId: string;
  sourceOrder: number;
  row: DataRecord;
};

export type SearchInput = {
  rows: ViewEngineRow[];
  query: string;
  candidateRowIds: CandidateRowIds;
};

export type SearchResult = {
  sourceRows: ViewEngineRow[];
  candidateRows: ViewEngineRow[];
  searchRows: ViewEngineRow[];
  sourceOrderRowIds: string[];
  candidateRowIds: CandidateRowIds;
  searchRowIds: string[];
};

export type ViewInput = SearchInput & {
  filters: FilterGroup;
  sorts: SortRule[];
  fieldTypes?: Record<string, string>;
  optionOrdersByField?: Record<string, string[]>;
};

export type ViewResult = {
  sourceRows: ViewEngineRow[];
  candidateRows: ViewEngineRow[];
  searchRows: ViewEngineRow[];
  filteredRows: ViewEngineRow[];
  visibleRows: ViewEngineRow[];
  sourceOrderRowIds: string[];
  candidateRowIds: CandidateRowIds;
  searchRowIds: string[];
  filteredRowIds: string[];
  visibleRowIds: string[];
};
