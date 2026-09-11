export class ConsoleRequestError extends Error {
  constructor(
    message: string,
    readonly uncertain: boolean,
  ) {
    super(message);
  }
}
export async function consoleRequest<T>(
  token: string,
  action?: string,
  extra: Record<string, unknown> = {},
  view?: "journal",
  transport: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    action ? 180_000 : view ? 6_000 : 25_000,
  );
  try {
    const response = await transport(
      `/api/console${view ? "?view=journal" : ""}`,
      {
        method: action ? "POST" : "GET",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          ...(action ? { "content-type": "application/json" } : {}),
        },
        ...(action ? { body: JSON.stringify({ action, ...extra }) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new ConsoleRequestError(
        typeof data.error === "string" && data.error.length < 220
          ? data.error
          : "服务校验失败，执行保持阻断。",
        false,
      );
    return data as T;
  } catch (error) {
    if (error instanceof ConsoleRequestError) throw error;
    throw new ConsoleRequestError(
      action
        ? "请求结果尚未确认；刷新只会读取记录，不会重发。请勿重复点击或重新签名。"
        : "暂时无法读取服务状态；已显示的记录仍保留，可重试读取。",
      Boolean(action),
    );
  } finally {
    clearTimeout(timer);
  }
}
