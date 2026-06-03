import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { icons } from "./icons";
import type { DataFile } from "../api/client";
import type { ProjectDefinition } from "../api/client";
import type { CollectionInfo } from "../model/documentModel";
import { moveFileToIndex } from "../file-order.mjs";

type SidebarProps = {
  projects?: ProjectDefinition[];
  activeProjectId?: string | null;
  files: DataFile[];
  selectedPath: string | null;
  collections: CollectionInfo[];
  selectedCollection: string;
  candidateCollections?: string[];
  metadata: { key: string; summary: string }[];
  onSelectFile: (path: string) => void;
  onReorderFiles?: (fileOrder: string[]) => void;
  onSelectCollection: (path: string) => void;
  onSelectProject?: (projectId: string) => void;
  onOpenProjectSettings?: () => void;
};

export function Sidebar(props: SidebarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [previewFileOrder, setPreviewFileOrder] = useState<string[] | null>(null);
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const fileDragRef = useRef<{
    pointerId: number;
    sourcePath: string;
    startX: number;
    startY: number;
    dragging: boolean;
    order: string[];
  } | null>(null);
  const suppressNextFileClickRef = useRef(false);
  const activeProject = props.projects?.find((project) => project.id === props.activeProjectId) ?? props.projects?.[0] ?? null;
  const filesByPath = new Map(props.files.map((file) => [file.path, file]));
  const visibleFiles = previewFileOrder
    ? previewFileOrder.map((path) => filesByPath.get(path)).filter((file): file is DataFile => Boolean(file))
    : props.files;

  useEffect(() => {
    if (!projectMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [projectMenuOpen]);

  useEffect(() => {
    setPreviewFileOrder(null);
    setDraggingFilePath(null);
    fileDragRef.current = null;
  }, [props.files]);

  function beginFileDrag(event: ReactPointerEvent<HTMLButtonElement>, sourcePath: string) {
    if (!props.onReorderFiles || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    fileDragRef.current = {
      pointerId: event.pointerId,
      sourcePath,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      order: props.files.map((file) => file.path),
    };
  }

  function updateFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = fileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragging) {
      if (Math.hypot(deltaX, deltaY) < 6) return;
      drag.dragging = true;
      suppressNextFileClickRef.current = true;
      setDraggingFilePath(drag.sourcePath);
      setPreviewFileOrder(drag.order);
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-file-path]") as HTMLElement | null;
    const targetPath = target?.dataset.filePath;
    if (!targetPath || !drag.order.includes(targetPath) || targetPath === drag.sourcePath) return;
    const projectedOrder = drag.order.filter((path) => path !== drag.sourcePath);
    const targetIndex = projectedOrder.indexOf(targetPath);
    if (targetIndex < 0) return;
    const rect = target.getBoundingClientRect();
    const dropIndex = targetIndex + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    const nextOrder = moveFileToIndex(drag.order, drag.sourcePath, dropIndex);
    drag.order = nextOrder;
    setPreviewFileOrder(nextOrder);
  }

  function endFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = fileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      event.preventDefault();
      props.onReorderFiles?.(drag.order);
      window.setTimeout(() => {
        suppressNextFileClickRef.current = false;
      }, 0);
    }
    fileDragRef.current = null;
    setPreviewFileOrder(null);
    setDraggingFilePath(null);
  }

  function cancelFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = fileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    fileDragRef.current = null;
    setPreviewFileOrder(null);
    setDraggingFilePath(null);
    window.setTimeout(() => {
      suppressNextFileClickRef.current = false;
    }, 0);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        {props.projects?.length ? (
          <div className="project-switcher" ref={switcherRef}>
            <button
              aria-expanded={projectMenuOpen}
              aria-haspopup="menu"
              className="project-switcher-trigger"
              onClick={() => setProjectMenuOpen((open) => !open)}
              type="button"
            >
              <span>{activeProject?.name ?? "Data Editor"}</span>
              <span className="project-switcher-caret" aria-hidden="true">▼</span>
            </button>
            <button
              aria-label="Project settings"
              className="project-switcher-add"
              onClick={props.onOpenProjectSettings}
              title="Project settings"
              type="button"
            >
              +
            </button>
            {projectMenuOpen ? (
              <div className="project-switcher-menu" role="menu">
                <div className="project-switcher-menu-label">浏览器本地</div>
                {props.projects.map((project) => (
                  <button
                    className={`project-switcher-option ${project.id === props.activeProjectId ? "selected" : ""}`}
                    key={project.id}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      props.onSelectProject?.(project.id);
                    }}
                    role="menuitemradio"
                    aria-checked={project.id === props.activeProjectId}
                    type="button"
                  >
                    {project.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : "Data Editor"}
      </div>
      <div className="sidebar-section">
        <div className="sidebar-label">Files</div>
        <div className="sidebar-list">
          {visibleFiles.map((file) => {
            const Icon = file.path.endsWith(".csv") ? icons.csvFile : icons.jsonFile;
            const fileName = baseName(file.path);
            return (
              <button
                className={`sidebar-item sidebar-file-item ${props.selectedPath === file.path ? "selected" : ""} ${draggingFilePath === file.path ? "is-dragging" : ""}`}
                data-file-path={file.path}
                key={file.path}
                onClick={(event) => {
                  if (suppressNextFileClickRef.current) {
                    event.preventDefault();
                    suppressNextFileClickRef.current = false;
                    return;
                  }
                  props.onSelectFile(file.path);
                }}
                onPointerCancel={cancelFileDrag}
                onPointerDown={(event) => beginFileDrag(event, file.path)}
                onPointerMove={updateFileDrag}
                onPointerUp={endFileDrag}
                title={file.path}
              >
                <Icon size={16} />
                <span>{file.displayPath ?? fileName}</span>
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
