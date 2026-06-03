import type { SaveDocumentsResult } from "../api/client";
import type { PrimaryKeyImpact, PrimaryKeySyncPlan, RelationBacklink } from "../model/relationMaintenance";
import { icons } from "./icons";

type RelationBacklinksPanelProps = {
  backlinks: RelationBacklink[];
  impacts: Record<string, PrimaryKeyImpact>;
  syncPlan: PrimaryKeySyncPlan | null;
  syncResult: SaveDocumentsResult | null;
  syncing: boolean;
  onOpenBacklink: (backlink: RelationBacklink) => void;
  onRequestSyncSave: () => void;
};

export function RelationBacklinksPanel({
  backlinks,
  impacts,
  syncPlan,
  syncResult,
  syncing,
  onOpenBacklink,
  onRequestSyncSave,
}: RelationBacklinksPanelProps) {
  const activeImpacts = Object.entries(impacts).filter(([, impact]) => impact.affectedCount > 0);
  const hasSyncPlan = Boolean(syncPlan && syncPlan.oldValue !== syncPlan.newValue);
  const hasBlockingIssues = Boolean(syncPlan?.blockingIssues.length);
  const hasSkipped = Boolean(syncPlan?.skipped.length);
  const canSync = Boolean(syncPlan && !syncPlan.blockingIssues.length && syncPlan.rewrites.length > 0);
  const showImpactWarnings = activeImpacts.length > 0 && hasSyncPlan && (hasBlockingIssues || hasSkipped);

  if (!backlinks.length && !activeImpacts.length && !hasSyncPlan) return null;

  return (
    <section className="relation-maintenance-panel">
      {backlinks.length ? (
        <div className="relation-maintenance-section">
          <div className="relation-maintenance-title">
            <icons.relation size={15} />
            <span>被引用</span>
            <small>{backlinks.length}</small>
          </div>
          <div className="relation-backlink-list">
            {backlinks.map((backlink) => (
              <button
                className="relation-backlink-item"
                key={`${backlink.relationKey}:${backlink.rowIndex}`}
                onClick={() => onOpenBacklink(backlink)}
                type="button"
              >
                <strong>{backlink.title}</strong>
                <span>
                  {backlink.sourceFile} / {backlink.sourceCollection} / {backlink.fieldPath.join(".")}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showImpactWarnings ? activeImpacts.map(([fieldName, impact]) => (
        <div className="relation-maintenance-section warning" key={fieldName}>
          <div className="relation-maintenance-title">
            <icons.incompatible size={15} />
            <span>{fieldName} 改名影响</span>
            <small>{impact.affectedCount}</small>
          </div>
          <p>{buildImpactMessage(syncPlan, impact.affectedCount)}</p>
        </div>
      )) : null}

      {hasSyncPlan && syncPlan ? (
        <div className={`relation-maintenance-section ${hasBlockingIssues || hasSkipped ? "warning" : ""}`}>
          <div className="relation-maintenance-title">
            <icons.save size={15} />
            <span>检测到关联引用</span>
            <small>{syncPlan.rewrites.length}</small>
          </div>
          <p>{buildSyncSummary(syncPlan)}</p>
          {hasSkipped ? (
            <p>另有 {syncPlan.skipped.length} 条命中超出首版同步范围，仍需你后续手动处理。</p>
          ) : null}
          {syncResult && !syncResult.ok ? (
            <p>最近一次同步保存未完成，请根据提示检查已成功和失败文件。</p>
          ) : null}
          {canSync ? (
            <div className="relation-maintenance-actions">
              <button className="primary-button" disabled={syncing} onClick={onRequestSyncSave} type="button">
                {syncing ? "准备中..." : "保存并同步引用"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function buildImpactMessage(syncPlan: PrimaryKeySyncPlan | null, affectedCount: number) {
  if (!syncPlan || syncPlan.oldValue === syncPlan.newValue) {
    return `当前有 ${affectedCount} 条记录正在引用这个值。若后续修改该主键，保存时会尝试同步这些关联。`;
  }
  if (syncPlan.blockingIssues.length) {
    return `当前有 ${affectedCount} 条记录正在引用这个值，但本次同步保存存在阻断问题，暂时不能自动同步。`;
  }
  if (syncPlan.skipped.length) {
    return `当前有 ${affectedCount} 条记录正在引用这个值。其中部分命中超出首版同步范围，本次仍可能留下需要手动修正的关联。`;
  }
  return `当前有 ${affectedCount} 条记录正在引用这个值，保存时将一并同步更新。`;
}

function buildSyncSummary(syncPlan: PrimaryKeySyncPlan) {
  if (syncPlan.blockingIssues.length) {
    return "当前改名已命中关联引用，但由于存在阻断问题，本次不能直接执行同步保存。";
  }
  if (syncPlan.skipped.length) {
    return `当前有 ${syncPlan.rewrites.length} 条关联会自动同步，另有 ${syncPlan.skipped.length} 条命中超出首版同步范围。`;
  }
  return `当前有 ${syncPlan.rewrites.length} 条关联引用，保存时将同步更新。`;
}
