import { AlertTriangle, BadgeCheck } from "lucide-react";

type Props = {
  eyebrow: string;
  title: string;
  description?: string;
  review: "reviewed" | "draft";
  reviewDetail?: string;
  titleAs?: "h1" | "p";
};

export function LearningHeading({ eyebrow, title, description, review, reviewDetail, titleAs: Title = "h1" }: Props) {
  const Icon = review === "reviewed" ? BadgeCheck : AlertTriangle;
  return (
    <div className="learning-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <Title className="learning-heading-title">{title}</Title>
        {description && <p className="lead">{description}</p>}
      </div>
      <p className={`review-chip ${review}`}>
        <Icon aria-hidden="true" />
        {review === "reviewed" ? <>Reviewed{reviewDetail && <span className="chip-detail"> · {reviewDetail}</span>}</> : "Draft — not reviewed"}
      </p>
    </div>
  );
}
