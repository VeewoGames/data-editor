// Synthetic product-neutral load shared by all four performance entrypoints.
export const perfFilePath = "data/records.json";
export const perfRowCount = 200;

export function createPerfRows() {
  return Array.from({ length: perfRowCount }, (_, index) => ({
    id: `record-${String(index + 1).padStart(3, "0")}`,
    name: `Record ${index + 1}`,
    group: index % 4 === 0 ? "planning" : "reference",
    description: `Record ${index + 1}: ` + "A neutral sample description used to observe wrapping and scrolling in a general purpose data editor. ".repeat(5),
    enabled: index % 2 === 0,
    score: index * 3,
    tags: [index % 4 === 0 ? "planning" : "reference", "sample"],
  }));
}

export function createPerfSharedViews() {
  return {
    collections: {
      [`${perfFilePath}:$`]: {
        defaultViewId: "all",
        items: [
          { kind: "view", icon: "table", view: { id: "all", name: "全部", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] } },
          { kind: "view", icon: "tablerFilledAccessible", view: { id: "planning", name: "规划", type: "table", query: "planning", filters: { op: "and", rules: [] }, sorts: [] } },
        ],
      },
    },
  };
}
