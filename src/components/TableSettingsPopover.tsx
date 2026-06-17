import { useEffect, useState } from "react";
import { icons } from "./icons";

type TableSettingsPopoverProps = {
  selectedFilePath: string | null;
  documentRoot: string;
  documentFields: Array<{ fieldName: string; enabled: boolean }>;
  rowDeleteControlsVisible: boolean;
  resolvedCount: number;
  conflictCount: number;
  indexError: string | null;
  onToggleRowDeleteControls: () => void;
  onSetDocumentFieldEnabled: (fieldName: string, enabled: boolean) => void;
  onSaveDocumentRoot: (value: string) => void;
  onRefreshDocumentIndex: () => void;
};

export function TableSettingsPopover({
  selectedFilePath,
  documentRoot,
  documentFields,
  rowDeleteControlsVisible,
  resolvedCount,
  conflictCount,
  indexError,
  onToggleRowDeleteControls,
  onSetDocumentFieldEnabled,
  onSaveDocumentRoot,
  onRefreshDocumentIndex,
}: TableSettingsPopoverProps) {
  const [draftDocumentRoot, setDraftDocumentRoot] = useState(documentRoot);

  useEffect(() => {
    setDraftDocumentRoot(documentRoot);
  }, [documentRoot, selectedFilePath]);

  const hasSelection = Boolean(selectedFilePath);
  const hasDraftChange = draftDocumentRoot.trim() !== documentRoot.trim();

  return (
    <div className="menu-content table-settings-popover">
      <div className="table-settings-section">
        <div className="table-settings-section-title">显示选项</div>
        <label className="table-settings-check">
          <input
            checked={rowDeleteControlsVisible}
            onChange={onToggleRowDeleteControls}
            type="checkbox"
          />
          <span>显示行删除控件</span>
        </label>
      </div>

      <div className="table-settings-section">
        <div className="table-settings-section-title">关联文档</div>
        {hasSelection ? (
          <>
            <div className="table-settings-file-path">{selectedFilePath}</div>
            <label className="dialog-field table-settings-field">
              <span>文档根目录</span>
              <input
                aria-label="文档根目录"
                onChange={(event) => setDraftDocumentRoot(event.target.value)}
                placeholder="例如 docs/keywords"
                value={draftDocumentRoot}
              />
            </label>
            <div className="table-settings-help">
              相对项目根目录；系统会递归扫描其中所有 .md 文件。
            </div>
            <div className="table-settings-help">
              解析规则：读取当前记录主键 ID，在该目录下唯一匹配同名 `.md` 文档。
            </div>
            <div className="table-settings-subsection">
              <div className="table-settings-subsection-title">启用字段</div>
              {documentFields.length > 0 ? (
                <div className="table-settings-field-list">
                  {documentFields.map((field) => (
                    <label className="table-settings-check" key={field.fieldName}>
                      <input
                        checked={field.enabled}
                        onChange={(event) => onSetDocumentFieldEnabled(field.fieldName, event.target.checked)}
                        type="checkbox"
                      />
                      <span>{field.fieldName}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="table-settings-empty">当前文件还没有 `Document` 类型字段。</div>
              )}
            </div>
            <div className="table-settings-summary">
              <span>已索引 {resolvedCount} 篇</span>
              <span>冲突 {conflictCount} 个</span>
            </div>
            {indexError ? <div className="dialog-error">{indexError}</div> : null}
            <div className="table-settings-actions">
              <button
                className="primary-button"
                disabled={!hasDraftChange}
                onClick={() => onSaveDocumentRoot(draftDocumentRoot)}
                type="button"
              >
                <icons.save size={15} />
                <span>保存文档根目录</span>
              </button>
              <button className="ghost-button" onClick={onRefreshDocumentIndex} type="button">
                <icons.refresh size={15} />
                <span>重新加载索引</span>
              </button>
            </div>
          </>
        ) : (
          <div className="table-settings-empty">请选择一个数据文件后再配置关联文档。</div>
        )}
      </div>
    </div>
  );
}
