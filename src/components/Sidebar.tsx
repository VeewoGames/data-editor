import { icons } from "./icons";
import type { DataFile } from "../api/client";
import type { CollectionInfo } from "../model/documentModel";

type SidebarProps = {
  files: DataFile[];
  selectedPath: string | null;
  collections: CollectionInfo[];
  selectedCollection: string;
  candidateCollections?: string[];
  metadata: { key: string; summary: string }[];
  onSelectFile: (path: string) => void;
  onSelectCollection: (path: string) => void;
};

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-title">Data Editor</div>
      <div className="sidebar-section">
        <div className="sidebar-label">Files</div>
        <div className="sidebar-list">
          {props.files.map((file) => {
            const Icon = file.path.endsWith(".csv") ? icons.csvFile : icons.jsonFile;
            const fileName = baseName(file.path);
            return (
              <button
                className={`sidebar-item ${props.selectedPath === file.path ? "selected" : ""}`}
                key={file.path}
                onClick={() => props.onSelectFile(file.path)}
                title={file.path}
              >
                <Icon size={16} />
                <span>{fileName}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-label">Collections</div>
        <div className="sidebar-list">
          {props.collections.map((collection) => (
            <button
              className={`sidebar-item ${props.selectedCollection === collection.path ? "selected" : ""}`}
              key={collection.path}
              onClick={() => props.onSelectCollection(collection.path)}
            >
              <icons.csvFile size={16} />
              <span>{collection.label}</span>
              <div className="sidebar-item-meta">
                {(props.candidateCollections ?? []).includes(collection.path) ? <span className="sidebar-status-dot" aria-label="待确认主键" /> : null}
                <small>{collection.rowCount}</small>
              </div>
            </button>
          ))}
        </div>
      </div>
      {props.metadata.length > 0 ? (
        <div className="sidebar-section">
          <div className="sidebar-label">Metadata</div>
          {props.metadata.map((item) => (
            <div className="metadata-row" key={item.key}>
              <span>{item.key}</span>
              <small>{item.summary}</small>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function baseName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}
