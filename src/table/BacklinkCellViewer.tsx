import { chipStyleForValue } from "./chipColors";
import type { RelationBacklink } from "../model/relationMaintenance";

type BacklinkCellViewerProps = {
  items: RelationBacklink[];
  status?: "active" | "missing-source";
  message?: string;
  wrapped?: boolean;
  onOpen: (item: RelationBacklink) => void;
};

export function BacklinkCellViewer({ items, status = "active", message, wrapped = false, onOpen }: BacklinkCellViewerProps) {
  if (!items.length) {
    const placeholder = status === "missing-source" ? "关联失效" : "-";
    return (
      <div className={`editable-cell cell-display backlink-display ${wrapped ? "cell-wrap" : ""} ${status === "missing-source" ? "backlink-display-invalid" : ""}`} title={message}>
        <span className={`backlink-placeholder ${status === "missing-source" ? "backlink-placeholder-invalid" : ""}`}>{placeholder}</span>
      </div>
    );
  }

  return (
    <div className={`chips-cell backlink-chips-cell ${wrapped ? "cell-wrap" : ""}`}>
      {items.map((item, index) => (
        <button
          className="chip backlink-chip-button"
          key={`${item.sourceFile}:${item.rowIndex}:${index}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
          type="button"
          style={chipStyleForValue(item.title, "gray")}
          title={`${item.title} (${item.sourceFile})`}
        >
          {item.title}
        </button>
      ))}
    </div>
  );
}
