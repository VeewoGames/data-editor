import { icons } from "./icons";
import type { PrimaryKeyCandidate } from "../model/primaryKeyCandidate";

type PrimaryKeyCandidateBannerProps = {
  filePath: string;
  collectionPath: string;
  candidates: PrimaryKeyCandidate[];
  onConfirm: () => void;
  onDismiss: () => void;
};

export function PrimaryKeyCandidateBanner(props: PrimaryKeyCandidateBannerProps) {
  const highConfidence = props.candidates.filter((candidate) => candidate.confidence === "high");
  const primaryCandidate = highConfidence[0] ?? props.candidates[0] ?? null;
  const hasMultiple = props.candidates.length > 1;
  const description = hasMultiple
    ? "检测到多个候选主键。该集合尚未配置 primary key，请确认后启用完整关联能力。"
    : primaryCandidate
      ? `检测到 1 个候选主键：${primaryCandidate.fieldName}。该集合尚未配置 primary key，部分关联能力暂不可用。`
      : "该集合尚未配置 primary key。";

  return (
    <section className="primary-key-candidate-banner">
      <div className="primary-key-candidate-banner__icon">
        <icons.incompatible size={16} />
      </div>
      <div className="primary-key-candidate-banner__content">
        <strong>候选主键待确认</strong>
        <span>{description}</span>
        <small>{props.filePath} / {props.collectionPath}</small>
      </div>
      <div className="primary-key-candidate-banner__actions">
        <button className="ghost-button compact" type="button" onClick={props.onDismiss}>暂不处理</button>
        <button className="primary-button compact" type="button" onClick={props.onConfirm}>
          {hasMultiple ? "选择主键" : "设为主键"}
        </button>
      </div>
    </section>
  );
}
