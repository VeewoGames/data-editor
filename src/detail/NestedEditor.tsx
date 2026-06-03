import { useEffect, useState } from "react";

type NestedEditorProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  onOpenNestedArray?: (path: Array<string | number>, value: unknown[]) => void;
};

export function NestedEditor({ value, onChange, onOpenNestedArray }: NestedEditorProps) {
  if (Array.isArray(value) && value.every((item) => item == null || typeof item !== "object")) {
    return <PrimitiveArrayEditor value={value} onChange={onChange} />;
  }
  if (Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    return <ObjectArrayEditor value={value as Record<string, unknown>[]} onChange={onChange} />;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return <ObjectEditor value={value as Record<string, unknown>} onChange={onChange} onOpenNestedArray={onOpenNestedArray} />;
  }
  return <JsonFallback value={value} onChange={onChange} />;
}

function PrimitiveArrayEditor({ value, onChange }: { value: unknown[]; onChange: (value: unknown) => void }) {
  return (
    <div className="nested-list">
      {value.map((item, index) => (
        <input
          key={index}
          value={item == null ? "" : String(item)}
          onChange={(event) => onChange(value.map((candidate, i) => i === index ? event.target.value : candidate))}
        />
      ))}
      <button className="ghost-button" onClick={() => onChange([...value, ""])}>Add item</button>
    </div>
  );
}

function ObjectEditor(props: {
  value: Record<string, unknown>;
  onChange: (value: unknown) => void;
  onOpenNestedArray?: (path: Array<string | number>, value: unknown[]) => void;
}) {
  return (
    <div className="nested-list">
      {Object.entries(props.value).map(([key, item]) => (
        <label className="property-row" key={key}>
          <span>{key}</span>
          {Array.isArray(item) && props.onOpenNestedArray ? (
            <button className="nested-entry-button inline" type="button" onClick={() => props.onOpenNestedArray?.([key], item)}>
              {item.length} 条
            </button>
          ) : item && typeof item === "object" ? (
            <NestedEditor
              value={item}
              onChange={(next) => props.onChange({ ...props.value, [key]: next })}
              onOpenNestedArray={props.onOpenNestedArray ? (path, nestedValue) => props.onOpenNestedArray?.([key, ...path], nestedValue) : undefined}
            />
          ) : shouldUseMultilineEditor(key, item) ? (
            <textarea
              className="detail-input detail-textarea"
              rows={4}
              value={item == null ? "" : String(item)}
              onChange={(event) => props.onChange({ ...props.value, [key]: event.target.value })}
            />
          ) : (
            <input value={item == null ? "" : String(item)} onChange={(event) => props.onChange({ ...props.value, [key]: event.target.value })} />
          )}
        </label>
      ))}
    </div>
  );
}

function ObjectArrayEditor({ value, onChange }: { value: Record<string, unknown>[]; onChange: (value: unknown) => void }) {
  const headers = [...new Set(value.flatMap((row) => Object.keys(row)))];
  return (
    <div className="mini-table-wrap">
      <table className="mini-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {value.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header) => (
                <td key={header}>
                  {row[header] && typeof row[header] === "object" ? (
                    <JsonFallback value={row[header]} onChange={(next) => onChange(value.map((candidate, i) => i === rowIndex ? { ...candidate, [header]: next } : candidate))} />
                  ) : (
                    <input
                      value={row[header] == null ? "" : String(row[header])}
                      onChange={(event) => onChange(value.map((candidate, i) => i === rowIndex ? { ...candidate, [header]: event.target.value } : candidate))}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ghost-button" onClick={() => onChange([...value, {}])}>Add nested row</button>
    </div>
  );
}

function JsonFallback({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState("");

  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setError("");
  }, [value]);

  return (
    <div className="json-editor">
      <textarea value={text} onChange={(event) => setText(event.target.value)} />
      <div className="json-actions">
        <button className="ghost-button" onClick={() => {
          try {
            const parsed = JSON.parse(text);
            const pretty = JSON.stringify(parsed, null, 2);
            setText(pretty);
            setError("");
            onChange(parsed);
          } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : String(parseError));
          }
        }}>格式化</button>
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </div>
  );
}

function shouldUseMultilineEditor(fieldName: string, value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = fieldName.toLowerCase();
  if (value.includes("\n")) return true;
  if (value.length >= 60) return true;
  return /(description|summary|notes?|text|content|body|dialog|dialogue|lore|flavor)/.test(normalized);
}
