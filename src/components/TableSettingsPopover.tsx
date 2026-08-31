import { useEffect, useState } from "react";
import { icons } from "./icons";

type TableSettingsPopoverProps = {
  selectedFilePath: string | null;
  documentRoot: string;
  documentFields: Array<{ fieldName: string; label: string; enabled: boolean }>;
  resolvedCount: number;
  conflictCount: number;
  indexError: string | null;
  onSetDocumentFieldEnabled: (fieldName: string, enabled: boolean) => void;
  onSaveDocumentRoot: (value: string) => void;
  onRefreshDocumentIndex: () => void;
};

export function TableSettingsPopover({
  selectedFilePath,
  documentRoot,
  documentFields,
  resolvedCount,
  conflictCount,
  indexError,
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
      <div className="table-settings-heading">
        <div className="table-settings-heading-icon"><icons.document size={18} /></div>
        <div>
          <div className="table-settings-eyebrow">文档关联</div>
          <div className="table-settings-section-title">为当前数据文件建立文档索引</div>
        </div>
      </div>
      <div className="table-settings-section">
        {hasSelection ? (
          <>
            <div className="table-settings-file-context">
              <span>当前文件</span>
              <code>{selectedFilePath}</code>
            </div>
            <label className="dialog-field table-settings-field">
              <span>文档根目录 <em>相对项目根目录</em></span>
              <div className="table-settings-root-control">
                <input
                  aria-label="文档根目录"
                  onChange={(event) => setDraftDocumentRoot(event.target.value)}
                  placeholder="例如 docs/keywords"
                  value={draftDocumentRoot}
                />
                <button
                  className="primary-button table-settings-apply"
                  disabled={!hasDraftChange}
                  onClick={() => onSaveDocumentRoot(draftDocumentRoot)}
                  type="button"
                >
                  <icons.save size={15} />
                  <span>应用</span>
                </button>
              </div>
            </label>
            <div className="table-settings-help table-settings-rule">
              读取记录主键 ID，在此目录下唯一匹配同名 <code>.md</code> 文档。
            </div>
            <div className="table-settings-subsection">
              <div className="table-settings-subsection-heading">
                <div className="table-settings-subsection-title">关联字段</div>
                <span>决定哪些字段显示文档链接</span>
              </div>
              {documentFields.length > 0 ? (
                <div className="table-settings-field-list">
                  {documentFields.map((field) => (
                    <label className="table-settings-check" key={field.fieldName}>
                      <input
                        checked={field.enabled}
                        onChange={(event) => onSetDocumentFieldEnabled(field.fieldName, event.target.checked)}
                        type="checkbox"
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="table-settings-empty">当前文件还没有 `Document` 类型字段。</div>
              )}
            </div>
            <div className="table-settings-summary" aria-label="文档索引状态">
              <div className="table-settings-stat is-resolved">
                <strong>{resolvedCount}</strong><span>已索引文档</span>
              </div>
              <div className={`table-settings-stat ${conflictCount > 0 ? "is-warning" : "is-clear"}`}>
                <strong>{conflictCount}</strong><span>命名冲突</span>
              </div>
            </div>
            {indexError ? <div className="dialog-error">{indexError}</div> : null}
            <div className="table-settings-actions">
              <button className="ghost-button" onClick={onRefreshDocumentIndex} type="button">
                <icons.refresh size={15} />
                <span>刷新索引</span>
              </button>
            </div>
          </>
        ) : (
          <div className="table-settings-empty">选择一个数据文件后，即可设置文档目录和关联字段。</div>
        )}
      </div>
    </div>
  );
}
