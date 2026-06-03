import { useEffect, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { icons } from "./icons";

type ToolbarProps = {
  currentPath: string | null;
  collectionPath: string;
  viewProfiles: string[];
  selectedViewProfileName: string | null;
  rowCount: number;
  visibleCount: number;
  query: string;
  dirty: boolean;
  saving: boolean;
  closing: boolean;
  rebuilding: boolean;
  status: string;
  hiddenFields: string[];
  onQueryChange: (value: string) => void;
  onSave: () => void;
  onRefreshBuild: () => void;
  onCloseServer: () => void;
  onResetView: () => void;
  onSelectViewProfile: (name: string) => void;
  onCreateViewProfile: () => void;
  onUnhideField: (fieldName: string) => void;
  onUnhideAllFields: () => void;
};

export function Toolbar(props: ToolbarProps) {
  const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false);
  const hiddenPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hiddenPanelOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!hiddenPanelRef.current?.contains(event.target as Node)) setHiddenPanelOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [hiddenPanelOpen]);

  useEffect(() => {
    if (props.hiddenFields.length === 0) setHiddenPanelOpen(false);
  }, [props.hiddenFields]);

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <strong>{props.currentPath ?? "No file selected"}</strong>
        <span>{props.collectionPath}</span>
      </div>
      <label className="search-box">
        <icons.search size={16} />
        <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search" />
      </label>
      <div className="toolbar-profile-picker">
        <Select.Root value={props.selectedViewProfileName ?? "__local__"} onValueChange={props.onSelectViewProfile}>
          <Select.Trigger className="select-trigger toolbar-profile-select-trigger" aria-label="View profile">
            <Select.Value />
            <Select.Icon />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="menu-content select-content toolbar-profile-select-content" position="popper" sideOffset={6}>
              <Select.Viewport>
                <Select.Item className="menu-item" value="__local__">
                  <Select.ItemText>浏览器本地</Select.ItemText>
                </Select.Item>
                {props.viewProfiles.map((profile) => (
                  <Select.Item className="menu-item" key={profile} value={profile}>
                    <Select.ItemText>{profile}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <button className="ghost-button icon-button toolbar-action-button" onClick={props.onCreateViewProfile} title="新建视图配置">
          <icons.addField size={16} />
        </button>
      </div>
      <div className="toolbar-spacer" />
      <span className="row-count">Visible {props.visibleCount} / Total {props.rowCount}</span>
      {props.dirty ? (
        <span className="dirty-pill">
          <icons.dirty size={14} />
          Unsaved
        </span>
      ) : null}
      {props.status ? <span className="status-text">{props.status}</span> : null}
      <div className="toolbar-hidden-fields" ref={hiddenPanelRef}>
        <button
          aria-label={props.hiddenFields.length > 0 ? `Hidden fields (${props.hiddenFields.length})` : "Hidden fields"}
          className="ghost-button icon-button toolbar-action-button"
          disabled={props.hiddenFields.length === 0}
          onClick={() => setHiddenPanelOpen((open) => !open)}
          title={props.hiddenFields.length > 0 ? `Hidden fields (${props.hiddenFields.length})` : "Hidden fields"}
        >
          <icons.hidden size={16} />
        </button>
        {hiddenPanelOpen ? (
          <div className="hidden-fields-panel">
            <div className="hidden-fields-header">
              <strong>Hidden fields</strong>
              <button className="ghost-button compact" onClick={props.onUnhideAllFields}>Restore all</button>
            </div>
            <div className="hidden-fields-list">
              {props.hiddenFields.map((fieldName) => (
                <button className="hidden-field-item" key={fieldName} onClick={() => props.onUnhideField(fieldName)}>
                  <span>{fieldName}</span>
                  <small>Restore</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <button
        aria-label="Reset view"
        className="ghost-button icon-button toolbar-action-button caution-button"
        onClick={props.onResetView}
        title="Reset view"
      >
        <icons.reset size={16} />
      </button>
      <button className="primary-button" disabled={!props.dirty || props.saving || props.closing || props.rebuilding} onClick={props.onSave}>
        <icons.save size={16} />
        {props.saving ? "保存中..." : "保存"}
      </button>
      <button
        aria-label="刷新构建"
        className={props.rebuilding ? "ghost-button toolbar-rebuild-button" : "ghost-button icon-button toolbar-rebuild-button"}
        disabled={props.rebuilding || props.closing || props.saving}
        onClick={props.onRefreshBuild}
        title="刷新构建"
        type="button"
      >
        <icons.refresh size={16} />
        {props.rebuilding ? "构建中..." : null}
      </button>
      <button
        aria-label="关闭服务"
        className={props.closing ? "ghost-button toolbar-close-button" : "ghost-button icon-button toolbar-close-button"}
        disabled={props.closing || props.saving || props.rebuilding}
        onClick={props.onCloseServer}
        title="关闭服务"
        type="button"
      >
        <icons.close size={16} />
        {props.closing ? "关闭中..." : null}
      </button>
    </header>
  );
}
