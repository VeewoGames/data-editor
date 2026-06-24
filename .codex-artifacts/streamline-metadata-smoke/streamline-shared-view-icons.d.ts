export type StreamlineSharedViewIconId =
  | "streamlineMicroSolidAttachment1"
;

export type StreamlineSharedViewIconMeta = {
  id: StreamlineSharedViewIconId;
  family: string;
  itemId: string;
  slug: string;
  sourceId: string | null;
  name: string;
  outputPath: string;
  tags: string[];
  searchText: string;
};

export declare const streamlineSharedViewIcons: readonly StreamlineSharedViewIconMeta[];
export declare const streamlineSharedViewIconIds: readonly StreamlineSharedViewIconId[];
export declare const streamlineSharedViewIconSearchTextById: Readonly<Record<StreamlineSharedViewIconId, string>>;
export declare const streamlineSharedViewIconGroups: readonly Array<{
  id: string;
  label: string;
  family: string;
  iconIds: readonly StreamlineSharedViewIconId[];
}>;
