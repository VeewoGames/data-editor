import { useEffect, useMemo, useRef, useState } from "react";
import { icons } from "./icons";
import type { DataFile, SidebarTreePreferences } from "../api/client";
import type { ProjectDefinition } from "../api/client";
import type { CollectionInfo } from "../model/documentModel";
import { applySidebarTreePreferences, buildSidebarTree } from "../sidebar-tree.mjs";
import { useSidebarTreeDragReorder } from "./useSidebarTreeDragReorder";

type SidebarProps = {
  projects?: ProjectDefinition[];
  activeProjectId?: string | null;
  files: DataFile[];
  selectedPath: string | null;
  collections: CollectionInfo[];
  selectedCollection: string;
  candidateCollections?: string[];
  metadata: { key: string; summary: string }[];
  sidebarTreePreferences: SidebarTreePreferences;
  sidebarTreeHasExplicitExpandedNodeIds: boolean;
  onSelectFile: (path: string) => void;
  onReorderFiles?: (fileOrder: string[], childOrderByParent?: Record<string, string[]>) => void;
  onExpandedNodeIdsChange?: (expandedNodeIds: string[] | null) => void;
  onSelectCollection: (path: string) => void;
  onSelectProject?: (projectId: string) => void;
  onOpenProjectSettings?: () => void;
};

type SidebarTreeNode = {
  id: string;
  kind: "source" | "folder" | "file";
  label: string;
  parentId: string | null;
  dataSourceId?: string;
  folderPath?: string;
  filePath?: string;
  file?: DataFile;
  children?: SidebarTreeNode[];
};

export function Sidebar(props: SidebarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const nodeButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeProject = props.projects?.find((project) => project.id === props.activeProjectId) ?? props.projects?.[0] ?? null;
  const tree = useMemo(() => buildSidebarTree(props.files) as SidebarTreeNode[], [props.files]);
  const committedChildOrderByParent = props.sidebarTreePreferences.childOrderByParent;
  const {
    beginNodeDrag,
    cancelNodeDrag,
    draggingNodeId,
    endNodeDrag,
    previewChildOrderByParent,
    suppressNextNodeClickRef,
    updateNodeDrag,
  } = useSidebarTreeDragReorder({
    childOrderByParent: committedChildOrderByParent,
    nodeButtonRefs,
    tree,
    onCommitOrder: (nextChildOrderByParent) => {
      props.onReorderFiles?.(
        flattenSidebarTreeFiles(
          applySidebarTreePreferences(tree, {
            childOrderByParent: nextChildOrderByParent,
            expandedNodeIds: [],
          }) as SidebarTreeNode[],
        ),
        nextChildOrderByParent,
      );
    },
  });
  const renderedChildOrderByParent = previewChildOrderByParent ?? committedChildOrderByParent;
  const orderedTree = useMemo(() => applySidebarTreePreferences(tree, {
    childOrderByParent: renderedChildOrderByParent,
    expandedNodeIds: [],
  }) as SidebarTreeNode[], [renderedChildOrderByParent, tree]);
  const defaultExpandedNodeIds = useMemo(() => collectExpandableNodeIds(orderedTree), [orderedTree]);
  const expandedNodeIds = useMemo(() => {
    if (!props.sidebarTreeHasExplicitExpandedNodeIds) return [...defaultExpandedNodeIds];
    return filterExpandedNodeIds(props.sidebarTreePreferences.expandedNodeIds, defaultExpandedNodeIds);
  }, [defaultExpandedNodeIds, props.sidebarTreeHasExplicitExpandedNodeIds, props.sidebarTreePreferences.expandedNodeIds]);
  const rootNodes = orderedTree.length === 1 && orderedTree[0]?.kind === "source"
    ? orderedTree[0].children ?? []
    : orderedTree;

  useEffect(() => {
    if (!projectMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [projectMenuOpen]);

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
              <icons.chevronDown className="project-switcher-caret" aria-hidden="true" size={16} />
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
        <div className="sidebar-list sidebar-tree-list">
          {rootNodes.map((node) => renderSidebarNode({
            draggingNodeId,
            expandedNodeIds: new Set(expandedNodeIds),
            node,
            nodeButtonRefs,
            onBeginNodeDrag: beginNodeDrag,
            onCancelNodeDrag: cancelNodeDrag,
            onEndNodeDrag: endNodeDrag,
            onSelectFile: props.onSelectFile,
            onToggleExpanded: (nodeId) => {
              const nextExpandedNodeIds = expandedNodeIds.includes(nodeId)
                ? expandedNodeIds.filter((value) => value !== nodeId)
                : [...expandedNodeIds, nodeId];
              const normalizedNextExpandedNodeIds = filterExpandedNodeIds(nextExpandedNodeIds, defaultExpandedNodeIds);
              props.onExpandedNodeIdsChange?.(
                sameExpandedNodeIds(normalizedNextExpandedNodeIds, defaultExpandedNodeIds)
                  ? null
                  : normalizedNextExpandedNodeIds,
              );
            },
            onUpdateNodeDrag: updateNodeDrag,
            selectedPath: props.selectedPath,
            suppressNextNodeClickRef,
          }))}
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

function renderSidebarNode(input: {
  node: SidebarTreeNode;
  selectedPath: string | null;
  draggingNodeId: string | null;
  expandedNodeIds: Set<string>;
  nodeButtonRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  suppressNextNodeClickRef: React.MutableRefObject<boolean>;
  onSelectFile: (path: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onBeginNodeDrag: (event: React.PointerEvent<HTMLButtonElement>, sourceNodeId: string) => void;
  onUpdateNodeDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onEndNodeDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onCancelNodeDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  depth?: number;
}) {
  const {
    draggingNodeId,
    expandedNodeIds,
    nodeButtonRefs,
    node,
    onBeginNodeDrag,
    onCancelNodeDrag,
    onEndNodeDrag,
    onSelectFile,
    onToggleExpanded,
    onUpdateNodeDrag,
    selectedPath,
    suppressNextNodeClickRef,
  } = input;
  const depth = input.depth ?? 0;
  const expandable = node.kind !== "file" && Boolean(node.children?.length);
  const expanded = expandable ? expandedNodeIds.has(node.id) : false;
  const isFile = node.kind === "file" && Boolean(node.filePath);
  const file = isFile ? node.file : undefined;
  const Icon = isFile
    ? ((node.filePath!.endsWith(".csv") ? icons.csvFile : icons.jsonFile))
    : null;
  const label = isFile && file?.displayPath ? baseName(file.displayPath) : node.label;
  const rowClassName = [
    "sidebar-item",
    "sidebar-tree-row",
    isFile ? "sidebar-file-item" : "sidebar-tree-item",
    `sidebar-${node.kind}-item`,
    selectedPath === node.filePath ? "selected" : "",
    draggingNodeId === node.id ? "is-dragging" : "",
    expanded ? "expanded" : "",
  ].filter(Boolean).join(" ");
  const rowContents = (
    <>
      <span
        aria-hidden="true"
        className="sidebar-tree-indent"
        data-sidebar-slot="indent"
      />
      <span
        aria-hidden="true"
        className={`sidebar-tree-control-slot ${expandable || Icon ? "is-present" : "is-empty"}`}
        data-sidebar-slot="control"
      >
        {expandable ? (
          <span className="sidebar-tree-toggle">
            <icons.chevronDown size={14} />
          </span>
        ) : Icon ? <Icon size={16} /> : null}
      </span>
      <span
        className="sidebar-tree-label"
        data-sidebar-slot="label"
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className="sidebar-tree-trailing-slot"
        data-sidebar-slot="trailing"
      />
    </>
  );

  if (isFile) {
    return (
      <button
        className={rowClassName}
        data-file-path={node.filePath}
        data-sidebar-node-id={node.id}
        data-sidebar-node-kind="file"
        key={node.id}
        ref={(element) => {
          nodeButtonRefs.current[node.id] = element;
        }}
        onClick={(event) => {
          if (suppressNextNodeClickRef.current) {
            event.preventDefault();
            suppressNextNodeClickRef.current = false;
            return;
          }
          onSelectFile(node.filePath!);
        }}
        onPointerCancel={onCancelNodeDrag}
        onPointerDown={(event) => onBeginNodeDrag(event, node.id)}
        onPointerMove={onUpdateNodeDrag}
        onPointerUp={onEndNodeDrag}
        style={{ ["--sidebar-tree-depth" as string]: depth }}
        title={node.filePath}
        type="button"
      >
        {rowContents}
      </button>
    );
  }

  return (
    <div className="sidebar-tree-group" data-sidebar-node-id={node.id} data-sidebar-node-kind={node.kind} key={node.id}>
      <button
        aria-expanded={expandable ? expanded : undefined}
        className={rowClassName}
        data-sidebar-node-id={node.id}
        data-sidebar-node-kind={node.kind}
        ref={(element) => {
          nodeButtonRefs.current[node.id] = element;
        }}
        onClick={(event) => {
          if (suppressNextNodeClickRef.current) {
            event.preventDefault();
            suppressNextNodeClickRef.current = false;
            return;
          }
          if (expandable) onToggleExpanded(node.id);
        }}
        onPointerCancel={onCancelNodeDrag}
        onPointerDown={(event) => onBeginNodeDrag(event, node.id)}
        onPointerMove={onUpdateNodeDrag}
        onPointerUp={onEndNodeDrag}
        style={{ ["--sidebar-tree-depth" as string]: depth }}
        type="button"
      >
        {rowContents}
      </button>
      {expandable && expanded
        ? node.children?.map((child) => renderSidebarNode({
          ...input,
          depth: depth + 1,
          node: child,
        }))
        : null}
    </div>
  );
}

function baseName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function flattenSidebarTreeFiles(nodes: SidebarTreeNode[]) {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.kind === "file" && node.filePath) {
      result.push(node.filePath);
      continue;
    }
    if (node.children?.length) result.push(...flattenSidebarTreeFiles(node.children));
  }
  return result;
}

function collectExpandableNodeIds(nodes: SidebarTreeNode[], result = new Set<string>()) {
  for (const node of nodes) {
    if (node.kind !== "file" && node.children?.length) {
      result.add(node.id);
      collectExpandableNodeIds(node.children, result);
    }
  }
  return result;
}

function filterExpandedNodeIds(expandedNodeIds: string[], validIds: Set<string>) {
  return expandedNodeIds.filter((id, index) => validIds.has(id) && expandedNodeIds.indexOf(id) === index);
}

function sameExpandedNodeIds(left: string[], right: Set<string>) {
  if (left.length !== right.size) return false;
  return left.every((id) => right.has(id));
}
