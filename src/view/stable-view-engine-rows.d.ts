import type { CollectionStore } from "../model/document-store";
import type { ViewEngineRow } from "./contracts";

export function buildStableViewEngineRows(collectionStore: CollectionStore | null, previousRows?: ViewEngineRow[] | null): ViewEngineRow[];
