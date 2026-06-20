import * as Select from "@radix-ui/react-select";
import { FieldTypeIcon } from "../FieldTypeIcon";
import { icons } from "../icons";
import type { FieldDisplayType } from "../../model/fieldTypes";

export type AdvancedFilterSelectOption = {
  value: string;
  label: string;
  fieldType?: FieldDisplayType | null;
};

type AdvancedFilterSelectProps = {
  ariaLabel: string;
  className?: string;
  contentClassName?: string;
  options: AdvancedFilterSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
};

export function AdvancedFilterSelect({
  ariaLabel,
  className = "",
  contentClassName = "",
  options,
  value,
  onValueChange,
}: AdvancedFilterSelectProps) {
  const active = options.find((option) => option.value === value) ?? options[0] ?? null;

  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className={`select-trigger advanced-filter-select-trigger ${className}`.trim()} aria-label={ariaLabel}>
        <span className="advanced-filter-select-trigger-value">
          {active?.fieldType ? (
            <span className="advanced-filter-select-icon">
              <FieldTypeIcon fieldType={active.fieldType} size={15} strokeWidth={2.1} />
            </span>
          ) : null}
          <span className="advanced-filter-select-label">{active?.label ?? ""}</span>
        </span>
        <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={`menu-content select-content advanced-filter-select-content ${contentClassName}`.trim()} position="popper" sideOffset={6}>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item className="menu-item advanced-filter-select-item" key={option.value} value={option.value}>
                {option.fieldType ? (
                  <span className="advanced-filter-select-icon">
                    <FieldTypeIcon fieldType={option.fieldType} size={15} strokeWidth={2.1} />
                  </span>
                ) : null}
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
