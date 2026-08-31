import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { loadDocument, type DataFile } from "../api/client";
import { icons } from "./icons";
import { SearchablePicker } from "./SearchablePicker";
import type { CollectionInfo, DataRecord, DocumentModel } from "../model/documentModel";
import { getMainColumns, getRows } from "../model/documentModel";
import type { RelationConfig, RelationMode } from "../model/viewConfig";
import type { FieldViewConfig } from "../model/viewConfig";
import { describeFileBasename, matchesFileSearchQuery } from "../searchable-picker-utils.mjs";

type RelationConfigDialogProps = {
  open: boolean;
  files: DataFile[];
  fieldName: string | null;
  fieldLabel?: string | null;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  config: RelationConfig | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (config: RelationConfig) => void;
};

const defaultTitleFields = "name, *_name, title, display_name";

export function RelationConfigDialog(props: RelationConfigDialogProps) {
  const [targetFile, setTargetFile] = useState("");
  const [targetCollection, setTargetCollection] = useState("$");
  const [targetKey, setTargetKey] = useState("");
  const [mode, setMode] = useState<RelationMode>("single");
  const [titleFields, setTitleFields] = useState(defaultTitleFields);
  const [allowMissing, setAllowMissing] = useState(true);
  const [targetModel, setTargetModel] = useState<DocumentModel | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingCollection, setPendingCollection] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [targetFilePickerOpen, setTargetFilePickerOpen] = useState(false);
  const [targetFileQuery, setTargetFileQuery] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const initialCollection = props.config?.targetCollection ?? "$";
    const initialKey = props.config?.targetKey ?? "";
    setTargetFile(props.config?.targetFile ?? props.files[0]?.path ?? "");
    setTargetCollection(initialCollection);
    setTargetKey(initialKey);
    setPendingCollection(initialCollection);
    setPendingKey(initialKey);
    setMode(props.config?.mode ?? "single");
    setTitleFields(props.config?.titleFields?.length ? props.config.titleFields.join(", ") : defaultTitleFields);
    setAllowMissing(props.config?.allowMissing ?? true);
    setTargetFilePickerOpen(false);
    setTargetFileQuery("");
  }, [props.open, props.config, props.files]);

  useEffect(() => {
    if (props.open) return;
    setTargetFilePickerOpen(false);
    setTargetFileQuery("");
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !targetFile) {
      setTargetModel(null);
      setLoadingTarget(false);
      return;
    }
    let cancelled = false;
    setLoadingTarget(true);
    setTargetModel(null);
    setLoadError("");
    loadDocument(targetFile)
      .then((documentModel) => {
        if (cancelled) return;
        setTargetModel(documentModel);
        setTargetCollection((current) => {
          const preferred = pendingCollection || current;
          return documentModel.collections.some((collection: CollectionInfo) => collection.path === preferred)
            ? preferred
            : documentModel.collections[0]?.path ?? "";
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setTargetModel(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingTarget(false);
      });
    return () => { cancelled = true; };
  }, [props.open, pendingCollection, targetFile]);

  const collections = targetModel?.collections ?? [];
  const targetFields = useMemo(() => {
    if (!targetModel) return [];
    const rows = getRows(targetModel, targetCollection);
    return getMainColumns(targetModel, targetCollection)
      .filter((field: string) => (rows as DataRecord[]).some((row) => Object.hasOwn(row, field)));
  }, [targetModel, targetCollection]);
  const visibleTargetFiles = useMemo(
    () => props.files.filter((file) => matchesFileSearchQuery(file.path, targetFileQuery)),
    [props.files, targetFileQuery],
  );

  useEffect(() => {
    if (!props.open || loadingTarget) return;
    if (targetKey && targetFields.includes(targetKey)) return;
    if (pendingKey && targetFields.includes(pendingKey)) {
      setTargetKey(pendingKey);
      setPendingKey("");
      return;
    }
    setTargetKey(chooseDefaultTargetKey(targetFields));
  }, [props.open, loadingTarget, pendingKey, targetFields, targetKey]);

  function submit() {
    const normalizedTitleFields = titleFields
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!isValidConfig) return;
    props.onConfirm({
      targetFile,
      targetCollection,
      targetKey,
      mode,
      titleFields: normalizedTitleFields.length ? normalizedTitleFields : ["name", "*_name", "title", "display_name"],
      allowMissing,
    });
  }

  const hasValidCollection = Boolean(targetModel?.collections.some((collection) => collection.path === targetCollection));
  const hasValidTargetKey = targetFields.includes(targetKey);
  const isValidConfig = Boolean(targetFile && hasValidCollection && hasValidTargetKey && !loadingTarget && !loadError);
  const targetFieldLabel = (field: string) => props.fieldViewConfigs[`${targetFile}:${targetCollection}:${field}`]?.presentation?.label ?? field;

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content relation-config-dialog">
          <Dialog.Title asChild><h2>{props.config ? "编辑关联字段" : "设为关联字段"}</h2></Dialog.Title>
          <div className="dialog-description">
            {props.fieldName ? `当前字段：${props.fieldLabel ?? props.fieldName}` : "选择一个字段后配置关联。"}
          </div>
          <label className="dialog-field">
            <span>目标文件</span>
            <SearchablePicker
              open={targetFilePickerOpen}
              onOpenChange={setTargetFilePickerOpen}
              query={targetFileQuery}
              onQueryChange={setTargetFileQuery}
              searchAriaLabel="筛选目标文件"
              searchPlaceholder="筛选文件..."
              listAriaLabel="目标文件候选列表"
              contentClassName="relation-target-file-picker-content"
              emptyContent={<div className="searchable-picker-empty">没有匹配的文件。</div>}
              trigger={(
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={targetFilePickerOpen}
                  className="select-trigger relation-target-file-picker-trigger"
                  title={targetFile}
                >
                  <span className="relation-target-file-picker-trigger__value">
                    {targetFile ? describeFileBasename(targetFile) : "选择目标文件"}
                  </span>
                  <icons.chevronDown size={16} />
                </button>
              )}
            >
              {visibleTargetFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`searchable-picker-option ${file.path === targetFile ? "is-selected" : ""}`}
                  onClick={() => {
                    setPendingCollection("");
                    setPendingKey("");
                    setTargetCollection("");
                    setTargetKey("");
                    setTargetFile(file.path);
                    setTargetFilePickerOpen(false);
                    setTargetFileQuery("");
                  }}
                  title={file.path}
                >
                  <span className="searchable-picker-option__title">{describeFileBasename(file.path)}</span>
                </button>
              ))}
            </SearchablePicker>
          </label>
          <label className="dialog-field">
            <span>目标集合</span>
            <Select.Root value={targetCollection} onValueChange={setTargetCollection} disabled={!collections.length}>
              <Select.Trigger className="select-trigger"><Select.Value placeholder="选择目标集合" /><Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon></Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content relation-config-select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {collections.map((collection) => (
                      <Select.Item className="menu-item" key={collection.path} value={collection.path}><Select.ItemText>{collection.path}</Select.ItemText></Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </label>
          <label className="dialog-field">
            <span>目标主键</span>
            <Select.Root value={targetKey} onValueChange={setTargetKey} disabled={!targetFields.length}>
              <Select.Trigger className="select-trigger"><Select.Value placeholder="选择主键字段" /><Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon></Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content relation-config-select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {targetFields.map((field: string) => (
                      <Select.Item className="menu-item" key={field} value={field}><Select.ItemText>{targetFieldLabel(field)}</Select.ItemText></Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </label>
          <label className="dialog-field">
            <span>关系模式</span>
            <Select.Root value={mode} onValueChange={(value) => setMode(value as RelationMode)}>
              <Select.Trigger className="select-trigger"><Select.Value /><Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon></Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content relation-config-select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    <Select.Item className="menu-item" value="single"><Select.ItemText>单值</Select.ItemText></Select.Item>
                    <Select.Item className="menu-item" value="multi"><Select.ItemText>多值</Select.ItemText></Select.Item>
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </label>
          <label className="dialog-field">
            <span>标题字段优先级</span>
            <input value={titleFields} onChange={(event) => setTitleFields(event.target.value)} placeholder={defaultTitleFields} />
          </label>
          <label className="dialog-check">
            <input checked={allowMissing} onChange={(event) => setAllowMissing(event.target.checked)} type="checkbox" />
            <span>显示缺失引用但允许保存</span>
          </label>
          {loadError ? <div className="dialog-error">{loadError}</div> : null}
          <div className="dialog-actions">
            <button className="ghost-button" onClick={() => props.onOpenChange(false)} type="button">取消</button>
            <button className="primary-button" disabled={!isValidConfig} onClick={submit} type="button">
              {loadingTarget ? "加载中" : "保存配置"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function chooseDefaultTargetKey(fields: string[]) {
  return fields.find((field) => field.endsWith("_id")) ?? fields.find((field) => field === "id") ?? fields[0] ?? "";
}
