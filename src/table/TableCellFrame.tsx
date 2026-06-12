import type { ReactNode } from "react";

export type TableCellContentKind =
  | "text"
  | "title"
  | "token"
  | "editor"
  | "checkbox"
  | "nested"
  | "backlink"
  | "incompatible";

export type TableCellLayout = "center" | "top";

type TableCellFrameProps = {
  kind: TableCellContentKind;
  layout?: TableCellLayout;
  children: ReactNode;
};

export function TableCellFrame({ kind, layout = "center", children }: TableCellFrameProps) {
  return (
    <div className="table-cell-frame" data-cell-frame-kind={kind} data-cell-frame-layout={layout}>
      <div className="table-cell-content" data-cell-content-kind={kind}>
        {children}
      </div>
    </div>
  );
}
