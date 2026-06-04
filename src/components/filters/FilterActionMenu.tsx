import { useState } from "react";
import { icons } from "../icons";

type FilterActionMenuProps = {
  onDelete: () => void;
};

export function FilterActionMenu({ onDelete }: FilterActionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="filter-action-menu-wrap">
      <button
        className="ghost-button icon-button filter-action-trigger"
        type="button"
        aria-expanded={open}
        aria-label="筛选操作"
        onClick={() => setOpen((value) => !value)}
      >
        <icons.more size={15} />
      </button>
      {open ? (
        <div className="menu-content filter-action-menu" role="menu">
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
            删除筛选
          </button>
        </div>
      ) : null}
    </div>
  );
}
