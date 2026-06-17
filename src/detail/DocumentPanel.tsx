import { forwardRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { icons } from "../components/icons";
import { ReadonlyMarkdownRenderer } from "../document-renderer/ReadonlyMarkdownRenderer";

export type DocumentPanelSnapshot = {
  open: boolean;
  width: number;
  activeFieldName: string | null;
  fieldName: string | null;
  documentId: string | null;
  title: string | null;
  relativePath: string | null;
  docRoot: string | null;
  content: string | null;
  status: "loading" | "resolved" | "missing" | "conflict" | "empty" | "error";
  matches: string[];
  errorMessage: string | null;
  fields: Record<string, string>;
};

type DocumentPanelProps = {
  snapshot: DocumentPanelSnapshot;
  style?: CSSProperties;
  onClose: () => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
};

export const DocumentPanel = forwardRef<HTMLElement, DocumentPanelProps>(function DocumentPanel(
  { snapshot, style, onClose, onWidthChange, onWidthCommit },
  ref,
) {
  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = snapshot.width;
    document.body.classList.add("is-resizing-detail-document-panel");

    function onPointerMove(moveEvent: PointerEvent) {
      onWidthChange(startWidth + (startX - moveEvent.clientX));
    }

    function finish() {
      document.body.classList.remove("is-resizing-detail-document-panel");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    }

    function onPointerUp(upEvent: PointerEvent) {
      onWidthCommit(startWidth + (startX - upEvent.clientX));
      finish();
    }

    function onPointerCancel() {
      finish();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  return (
    <aside
      className={`detail-panel document ${snapshot.open ? "open" : ""}`}
      ref={ref}
      style={style}
    >
      <div
        className="detail-document-panel-resize-handle"
        onPointerDown={beginResize}
        aria-label="调整文档面板宽度"
        role="separator"
      />
      <div className="detail-header">
        <div className="detail-nav">
          <button className="icon-button" onClick={onClose} title="Close document">
            <icons.close size={16} />
          </button>
        </div>
      </div>

      {snapshot.status === "loading" ? (
        <div className="document-panel-state">正在加载文档…</div>
      ) : null}
      {snapshot.status === "empty" ? (
        <div className="document-panel-state">当前记录没有可展示的关联文档。</div>
      ) : null}
      {snapshot.status === "missing" ? (
        <div className="document-panel-state">未找到匹配的 Markdown 文档。</div>
      ) : null}
      {snapshot.status === "error" ? (
        <div className="document-panel-state error">
          {snapshot.errorMessage ?? "文档加载失败。"}
        </div>
      ) : null}
      {snapshot.status === "conflict" ? (
        <div className="document-panel-state">
          <p>检测到多个同名文档，当前无法唯一定位。</p>
          <ul className="document-panel-conflicts">
            {snapshot.matches.map((match) => <li key={match}>{match}</li>)}
          </ul>
        </div>
      ) : null}
      {snapshot.status === "resolved" && snapshot.content ? (
        <div className="document-panel-content">
          <ReadonlyMarkdownRenderer value={snapshot.content} />
        </div>
      ) : null}

      {snapshot.relativePath || snapshot.documentId || snapshot.docRoot ? (
        <div className="document-panel-meta">
          {snapshot.title ? <span>{snapshot.title}</span> : null}
          {snapshot.relativePath || snapshot.documentId ? (
            <span>{snapshot.relativePath ?? snapshot.documentId}</span>
          ) : null}
          {snapshot.docRoot ? <span>docRoot: {snapshot.docRoot}</span> : null}
          {snapshot.fieldName ? <span>字段: {snapshot.fieldName}</span> : null}
        </div>
      ) : null}
    </aside>
  );
});
