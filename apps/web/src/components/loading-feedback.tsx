import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Spinner() {
  return <span className="ps-spinner" aria-hidden="true" />;
}
export function LoadingHint({
  children,
  active = true,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  if (!active) return null;
  return (
    <span className="ps-loading-hint">
      <Spinner />
      <span>{children}</span>
      <span className="ps-loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
export function BusyButton({
  loading = false,
  loadingText,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingText?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner />}
      {loading ? (loadingText ?? children) : children}
    </button>
  );
}
export function Skeleton({ label }: { label: string }) {
  return (
    <span className="ps-skeleton" role="status" aria-label={label}>
      <span className="ps-sr-only">{label}</span>
    </span>
  );
}
export function OperationNotice({
  label,
  wallet,
  elapsed = 0,
  slow = false,
}: {
  label: string;
  wallet?: boolean;
  elapsed?: number;
  slow?: boolean;
}) {
  return (
    <section
      className={`ps-operation-notice ${wallet ? "wallet" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="ps-operation-title">
        <LoadingHint>{wallet ? "等待你在 MetaMask 确认" : label}</LoadingHint>
        <span className="ps-elapsed" aria-hidden="true">
          已等待 {elapsed} 秒
        </span>
      </div>
      <p>
        {wallet
          ? "请打开 MetaMask，审阅当前这一次请求；页面仍在等待，不要重复点击。"
          : slow
            ? "耗时较长，仍在处理。不要重复提交；若请求超时，将保留记录并提示核对结果。"
            : "正在处理，请勿重复点击。已完成的步骤和交易记录会保留。"}
      </p>
      <div className="ps-indeterminate" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}
