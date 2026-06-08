import type { ComponentProps } from "react";
import type { FieldDisplayType } from "../model/fieldTypes";
import { icons } from "./icons";

type IconProps = Omit<ComponentProps<(typeof icons)["textField"]>, "aria-hidden">;

export function FieldTypeIcon({ fieldType, ...props }: { fieldType: FieldDisplayType } & IconProps) {
  if (fieldType === "Checkbox") return <icons.checkboxField aria-hidden="true" {...props} />;
  if (fieldType === "Select") return <icons.selectField aria-hidden="true" {...props} />;
  if (fieldType === "Multi-select") return <icons.multiSelectField aria-hidden="true" {...props} />;
  if (fieldType === "Relation" || fieldType === "Backlink") return <icons.relation aria-hidden="true" {...props} />;
  if (fieldType === "Number") return <icons.numberField aria-hidden="true" {...props} />;
  if (fieldType === "Date") return <icons.dateField aria-hidden="true" {...props} />;
  if (fieldType === "JSON") return <icons.json aria-hidden="true" {...props} />;
  if (fieldType === "Nested") return <icons.nested aria-hidden="true" {...props} />;
  return <icons.textField aria-hidden="true" {...props} />;
}
