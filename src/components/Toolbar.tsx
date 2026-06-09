import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import type { UiPreferences, UiTheme } from "../ui-preferences";
import type { AutosaveState } from "../save-coordinator";
import { icons } from "./icons";
import { ExpandableSearch } from "./ExpandableSearch";

type ToolbarProps = {
  currentPath: string | null;
  collectionPath: string;
  viewProfiles: string[];
  selectedViewProfileName: string | null;
  activeThemeId: UiTheme;
  baseFontSize: UiPreferences["baseFontSize"];
  rowCount: number;
  visibleCount: number;
  query: string;
  autosaveState: AutosaveState;
  saving: boolean;
  closing: boolean;
  rebuilding: boolean;
  status: string;
  hiddenFields: string[];
  onQueryChange: (value: string) => void;
  onRefreshBuild: () => void;
  onCloseServer: () => void;
  onResetView: () => void;
  onSelectViewProfile: (name: string) => void;
  onCreateViewProfile: () => void;
  onChangeTheme: (theme: UiTheme) => void;
  onChangeBaseFontSize: (size: UiPreferences["baseFontSize"]) => void;
  onUnhideField: (fieldName: string) => void;
  onUnhideAllFields: () => void;
};

const fontSizeOptions: UiPreferences["baseFontSize"][] = [14, 14.5, 15, 16];

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

  useEffect(() => {
    document.documentElement.dataset.theme = props.activeThemeId;
    document.documentElement.dataset.fontSizeBase = String(props.baseFontSize);
  }, [props.activeThemeId, props.baseFontSize]);

  const autosaveLabel = props.autosaveState === "pending"
    ? "待保存"
    : props.autosaveState === "saving"
      ? "保存中..."
      : props.autosaveState === "error"
        ? "保存失败"
        : props.autosaveState === "blocked-confirmation"
          ? "待确认"
          : "";

  return (
    <header className="toolbar">
      <div className="toolbar-title">
        <strong>{props.currentPath ?? "No file selected"}</strong>
        <span>{props.collectionPath}</span>
      </div>
      <ExpandableSearch className="search-box" value={props.query} alwaysExpanded onChange={props.onQueryChange} placeholder="搜索当前表格" />
      <div className="toolbar-spacer" />
      <span className="row-count">Visible {props.visibleCount} / Total {props.rowCount}</span>
      {autosaveLabel ? (
        <span className="dirty-pill">
          <icons.dirty size={14} />
          {autosaveLabel}
        </span>
      ) : null}
      {props.status ? <span className="status-text">{props.status}</span> : null}
      <div className="toolbar-profile-picker">
        <Select.Root value={props.selectedViewProfileName ?? "__local__"} onValueChange={props.onSelectViewProfile}>
          <Select.Trigger className="select-trigger toolbar-profile-select-trigger" aria-label="View profile">
            <Select.Value />
            <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
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
        <button className="ghost-button icon-button toolbar-action-button" onClick={props.onCreateViewProfile} title="新建视图配置" type="button">
          <icons.addField size={16} />
        </button>
      </div>
      <div className="toolbar-hidden-fields" ref={hiddenPanelRef}>
        <button
          aria-label={props.hiddenFields.length > 0 ? `Hidden fields (${props.hiddenFields.length})` : "Hidden fields"}
          className="ghost-button icon-button toolbar-action-button"
          disabled={props.hiddenFields.length === 0}
          onClick={() => setHiddenPanelOpen((open) => !open)}
          title={props.hiddenFields.length > 0 ? `Hidden fields (${props.hiddenFields.length})` : "Hidden fields"}
          type="button"
        >
          <icons.hidden size={16} />
        </button>
        {hiddenPanelOpen ? (
          <div className="hidden-fields-panel">
            <div className="hidden-fields-header">
              <strong>Hidden fields</strong>
              <button className="ghost-button compact" onClick={props.onUnhideAllFields} type="button">Restore all</button>
            </div>
            <div className="hidden-fields-list">
              {props.hiddenFields.map((fieldName) => (
                <button className="hidden-field-item" key={fieldName} onClick={() => props.onUnhideField(fieldName)} type="button">
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
        type="button"
      >
        <icons.reset size={16} />
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            aria-label="外观设置"
            className="ghost-button icon-button toolbar-action-button toolbar-settings-button"
            disabled={props.closing || props.saving}
            title="外观设置"
            type="button"
          >
            <icons.settings size={16} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content appearance-popover-content" sideOffset={6} align="end">
            <div className="appearance-popover">
              <section className="appearance-section" aria-label="Theme settings">
                <div className="appearance-section-header">
                  <strong>主题</strong>
                  <span>{props.activeThemeId === "dark" ? "深色" : "浅色"}</span>
                </div>
                <div className="appearance-segmented-control" role="group" aria-label="Theme">
                  <button
                    aria-pressed={props.activeThemeId === "light"}
                    className={props.activeThemeId === "light" ? "appearance-segment is-active" : "appearance-segment"}
                    data-theme-option="light"
                    onClick={() => props.onChangeTheme("light")}
                    type="button"
                  >
                    浅色
                  </button>
                  <button
                    aria-pressed={props.activeThemeId === "dark"}
                    className={props.activeThemeId === "dark" ? "appearance-segment is-active" : "appearance-segment"}
                    data-theme-option="dark"
                    onClick={() => props.onChangeTheme("dark")}
                    type="button"
                  >
                    深色
                  </button>
                </div>
              </section>
              <section className="appearance-section" aria-label="Base font size settings">
                <div className="appearance-section-header">
                  <strong>基础字号</strong>
                  <span>{props.baseFontSize}px</span>
                </div>
                <div className="appearance-segmented-control" role="group" aria-label="Base font size">
                  {fontSizeOptions.map((size) => (
                    <button
                      aria-pressed={props.baseFontSize === size}
                      className={props.baseFontSize === size ? "appearance-segment is-active" : "appearance-segment"}
                      data-font-size-option={String(size)}
                      key={size}
                      onClick={() => props.onChangeBaseFontSize(size)}
                      type="button"
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
