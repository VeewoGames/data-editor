import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

type DocumentFieldConfigDialogProps = {
  open: boolean;
  fieldName: string | null;
  sourcePath: string | null;
  docRoot: string | null;
  enabled: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (enabled: boolean) => void;
};

export function DocumentFieldConfigDialog({
  open,
  fieldName,
  sourcePath,
  docRoot,
  enabled,
  onOpenChange,
  onConfirm,
}: DocumentFieldConfigDialogProps) {
  const [draftEnabled, setDraftEnabled] = useState(enabled);

  useEffect(() => {
    if (!open) return;
    setDraftEnabled(enabled);
  }, [open, enabled, fieldName, sourcePath, docRoot]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content document-field-config-dialog">
          <Dialog.Title>关联文档配置</Dialog.Title>
          <div className="dialog-description">
            {fieldName ? `当前字段：${fieldName}` : "请选择一个 Document 字段。"}
          </div>
          <div className="document-field-config-meta">
            <div>文件：{sourcePath ?? "未选择文件"}</div>
            <div>docRoot：{docRoot ?? "尚未配置"}</div>
          </div>
          <label className="dialog-check">
            <input
              aria-label="启用关联文档"
              checked={draftEnabled}
              onChange={(event) => setDraftEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>启用关联文档</span>
          </label>
          <div className="document-field-config-help">
            <strong>解析规则</strong>
            <p>系统会读取当前记录主键 ID，并在 &lt;docRoot&gt; 下唯一匹配同名 .md 文档。</p>
          </div>
          {!docRoot ? (
            <div className="dialog-error">当前文件尚未配置文档根目录，请先在“调整”面板中设置 docRoot。</div>
          ) : null}
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button
              className="primary-button"
              onClick={() => onConfirm(draftEnabled)}
              type="button"
            >
              保存配置
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
