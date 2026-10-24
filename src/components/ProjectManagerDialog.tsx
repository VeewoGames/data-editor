import { useEffect, useRef, useState, type PointerEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ProjectDefinition } from "../api/client";
import { createOneDimensionalDragSession, createVerticalProjection, projectVerticalDrag } from "../drag/one-dimensional-dnd.mjs";
import { icons } from "./icons";

type Props = {
  open: boolean;
  projects: ProjectDefinition[];
  activeProjectId: string | null;
  busy: boolean;
  error: string | null;
  uncertain: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: () => void;
  onRefresh: () => void;
  onReorder: (ids: string[]) => Promise<void>;
  onRemove: (project: ProjectDefinition) => Promise<void>;
};

export function ProjectManagerDialog(props: Props) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const session = useRef<ReturnType<typeof createOneDimensionalDragSession> | null>(null);
  const ids = props.projects.map(project => project.id);
  const orderKey = ids.join("|");
  const renderedOrder = preview?.length === ids.length && preview.every(id => ids.includes(id)) ? preview : ids;
  const disabled = props.busy || props.uncertain;
  useEffect(() => {
    session.current?.cancel(); session.current = null; setPreview(null);
  }, [orderKey, props.open]);

  async function commit(next: string[]) {
    setPreview(null);
    if (next.join("|") === orderKey) return;
    await props.onReorder(next);
    setAnnouncement("项目排序操作已结束，请查看列表及保存提示。");
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || event.button !== 0) return;
    const items = ids.map(id => {
      const rect = rows.current[id]!.getBoundingClientRect();
      return { id, start: rect.top, size: rect.height };
    });
    const projection = createVerticalProjection({ axis: "vertical", items });
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = createOneDimensionalDragSession({
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      onPreview: ({ clientY }: { clientY: number }) => {
        const next = projectVerticalDrag({ projection, order: ids, activeId: id, pointer: clientY }).projectedOrder;
        setPreview(next); return next;
      },
      onCommit: (next: string[]) => { void commit(next); },
      onCancel: () => setPreview(null),
    });
  }

  function move(id: string, delta: number) {
    const next = [...ids]; const index = next.indexOf(id);
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    void commit(next);
  }

  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content project-manager-dialog" onEscapeKeyDown={event => {
        if (session.current) { event.preventDefault(); session.current.cancel(); session.current = null; }
      }}>
        <Dialog.Title>管理项目</Dialog.Title>
        <Dialog.Description>拖动手柄或使用上下移调整顺序。移除仅取消列表注册，不删除项目文件。</Dialog.Description>
        <div className="project-manager-toolbar">
          <button type="button" className="primary-button" disabled={disabled} onClick={props.onAdd}>添加项目</button>
          <button type="button" className="ghost-button" disabled={props.busy} onClick={props.onRefresh}>刷新列表</button>
          <span role="status">{props.busy ? "正在保存或刷新…" : props.uncertain ? "保存结果待确认" : "操作后自动保存"}</span>
        </div>
        {props.error ? <p className="project-manager-error" role="alert">{props.error}</p> : null}
        <ol className="project-manager-list" aria-label="项目排列">
          {renderedOrder.map((id, index) => {
            const project = props.projects.find(project => project.id === id)!;
            return <li key={id} ref={node => { rows.current[id] = node; }} data-project-id={id}>
              <button type="button" className="ghost-button icon-button project-drag-handle" aria-label={`拖动 ${project.name}`} disabled={disabled || ids.length < 2}
                onPointerDown={event => beginDrag(event, id)}
                onPointerMove={event => session.current?.pointerId === event.pointerId && session.current.move(event)}
                onPointerUp={event => { if (session.current?.pointerId === event.pointerId) { session.current.release(); session.current = null; } }}
                onPointerCancel={() => { session.current?.cancel(); session.current = null; }}
                onLostPointerCapture={() => { session.current?.cancel(); session.current = null; }}>
                <icons.dragHandle size={18} />
              </button>
              <div className="project-manager-label"><strong>{project.name}</strong>{id === props.activeProjectId ? <span>当前项目</span> : null}<small title={project.root}>{project.root}</small></div>
              <button type="button" className="ghost-button icon-button" aria-label={`上移 ${project.name}`} disabled={disabled || index === 0} onClick={() => move(id, -1)}><icons.up size={16} /></button>
              <button type="button" className="ghost-button icon-button" aria-label={`下移 ${project.name}`} disabled={disabled || index === ids.length - 1} onClick={() => move(id, 1)}><icons.down size={16} /></button>
              <button type="button" className="ghost-button project-remove-button" disabled={disabled || ids.length === 1} title={ids.length === 1 ? "至少保留一个项目" : `从列表移除 ${project.name}`} onClick={() => { void props.onRemove(project); }}>从列表移除</button>
            </li>;
          })}
        </ol>
        {ids.length === 1 ? <p>至少保留一个项目。</p> : null}
        <div className="project-manager-announcement" aria-live="polite">{announcement}</div>
        <div className="dialog-actions"><Dialog.Close className="primary-button" disabled={props.busy}>完成</Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
