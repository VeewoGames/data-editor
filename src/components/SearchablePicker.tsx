import { Children, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

type SearchablePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  trigger: ReactNode;
  searchPlaceholder: string;
  searchAriaLabel: string;
  listAriaLabel: string;
  emptyContent: ReactNode;
  contentClassName?: string;
  shellClassName?: string;
  listClassName?: string;
  children?: ReactNode;
};

export function SearchablePicker(props: SearchablePickerProps) {
  const {
    open,
    onOpenChange,
    query,
    onQueryChange,
    trigger,
    searchPlaceholder,
    searchAriaLabel,
    listAriaLabel,
    emptyContent,
    contentClassName = "",
    shellClassName = "",
    listClassName = "",
    children,
  } = props;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) onQueryChange("");
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`menu-content searchable-picker-content ${contentClassName}`.trim()} sideOffset={6} align="start">
          <div className={`searchable-picker-shell ${shellClassName}`.trim()}>
            <input
              aria-label={searchAriaLabel}
              className="searchable-picker-search"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              value={query}
            />
            <div
              className={`searchable-picker-list ${listClassName}`.trim()}
              role="listbox"
              aria-label={listAriaLabel}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {Children.count(children) ? children : emptyContent}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
