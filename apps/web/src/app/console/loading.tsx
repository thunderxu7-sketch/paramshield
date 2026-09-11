import { LoadingHint, Skeleton } from "@/components/loading-feedback";
export default function ConsoleLoading() {
  return (
    <main className="ps-console">
      <div className="ps-main" aria-busy="true">
        <h1>ParamShield</h1>
        <div className="ps-progress" role="status">
          <LoadingHint>正在载入控制台；不会重新发送交易</LoadingHint>
        </div>
        <Skeleton label="载入控制台内容" />
        <Skeleton label="载入已保存进度" />
      </div>
    </main>
  );
}
