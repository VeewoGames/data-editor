import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import type { FieldPresentation } from "../model/viewConfig";

type FieldPresentationDialogProps = {
  open: boolean;
  fieldName: string | null;
  presentation?: FieldPresentation;
  onOpenChange: (open: boolean) => void;
  onConfirm: (presentation: FieldPresentation | null) => void;
};

function normalizeDraft(value: string) {
  return value.trim();
}

export function FieldPresentationDialog({ open, fieldName, presentation, onOpenChange, onConfirm }: FieldPresentationDialogProps) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(presentation?.label ?? "");
    setDescription(presentation?.description ?? "");
  }, [open, fieldName, presentation]);

  const save = () => {
    const nextLabel = normalizeDraft(label);
    const nextDescription = normalizeDraft(description);
    onConfirm(nextLabel || nextDescription ? {
      ...(nextLabel ? { label: nextLabel } : {}),
      ...(nextDescription ? { description: nextDescription } : {}),
    } : null);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content field-presentation-dialog">
          <Dialog.Title>编辑字段说明</Dialog.Title>
          <div className="dialog-description">字段名：<code>{fieldName ?? "未选择"}</code></div>
          <label className="dialog-field">
            <span>显示名称</span>
            <input aria-label="显示名称" maxLength={120} onChange={(event) => setLabel(event.target.value)} value={label} />
          </label>
          <label className="dialog-field">
            <span>字段说明</span>
            <textarea aria-label="字段说明" maxLength={2000} onChange={(event) => setDescription(event.target.value)} rows={5} value={description} />
          </label>
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="ghost-button" onClick={() => onConfirm(null)} type="button">清除</button>
            <button className="primary-button" onClick={save} type="button">保存</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
