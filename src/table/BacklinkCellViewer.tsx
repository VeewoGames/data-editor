import { memo } from "react";
import { chipStyleForValue } from "./chipColors";
import type { RelationBacklink } from "../model/relationMaintenance";

type BacklinkCellViewerProps = {
  items: RelationBacklink[];
  status?: "active" | "missing-source";
  message?: string;
  wrapped?: boolean;
  onOpen: (item: RelationBacklink) => void;
};

function BacklinkCellViewerComponent({ items, status = "active", message, wrapped = false, onOpen }: BacklinkCellViewerProps) {
  if (!items.length) {
    const placeholder = status === "missing-source" ? "关联失效" : "-";
    return (
      <div className="table-cell-content-main">
        <div
          className={`editable-cell cell-display cell-text-content backlink-display ${wrapped ? "cell-text-wrap" : ""} ${status === "missing-source" ? "backlink-display-invalid" : ""}`}
          data-cell-role="content"
          data-wrap-mode={wrapped ? "wrap" : "truncate"}
          title={message}
        >
          <span className={`backlink-placeholder ${status === "missing-source" ? "backlink-placeholder-invalid" : ""}`}>{placeholder}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="table-cell-content-main">
      <div className={`chips-cell backlink-chips-cell ${wrapped ? "cell-token-flow" : ""}`} data-cell-role="token-content" data-wrap-mode={wrapped ? "wrap" : "truncate"}>
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
    </div>
  );
}

export const BacklinkCellViewer = memo(BacklinkCellViewerComponent, (previous, next) =>
  previous.items === next.items &&
  previous.status === next.status &&
  previous.message === next.message &&
  previous.wrapped === next.wrapped &&
  previous.onOpen === next.onOpen,
);
