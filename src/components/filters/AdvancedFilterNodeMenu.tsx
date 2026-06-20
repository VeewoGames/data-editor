import { useEffect, useRef, useState } from "react";
import { icons } from "../icons";

type AdvancedFilterNodeMenuProps = {
  onDelete: () => void;
  onDuplicate?: (() => void) | null;
  onConvertToGroup?: (() => void) | null;
};

export function AdvancedFilterNodeMenu({
  onDelete,
  onDuplicate = null,
  onConvertToGroup = null,
}: AdvancedFilterNodeMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-action-menu-wrap" ref={menuRef}>
      <button
        className="ghost-button icon-button filter-action-trigger"
        type="button"
        aria-expanded={open}
        aria-label="高级筛选节点操作"
        onClick={() => setOpen((value) => !value)}
      >
        <icons.more size={15} />
      </button>
      {open ? (
        <div className="menu-content filter-action-menu filter-action-menu-side" role="menu">
          {onDelete ? (
            <button
              className="menu-item danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              type="button"
              role="menuitem"
            >
              <icons.delete size={15} />
              移除
            </button>
          ) : null}
          {onDuplicate ? (
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onDuplicate();
              }}
              type="button"
              role="menuitem"
            >
              <icons.copy size={15} />
              创建副本
            </button>
          ) : null}
          {onConvertToGroup ? (
            <button
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onConvertToGroup();
              }}
              type="button"
              role="menuitem"
            >
              <icons.nested size={15} />
              转换成分组
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
