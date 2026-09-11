"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleJournal, ConsoleStatus, FlowView } from "./console-types";
import { ConsoleRequestError, consoleRequest } from "./console-request";
import {
  emptyWorkspace,
  mergeHistory,
  reconcilePending,
  rejectedCurrentWalletRequest,
  restoreWorkspace,
  WORKSPACE_KEY,
  type PendingOperation,
  type Workspace,
} from "./console-state";
import {
  observeWallet,
  type ConsoleProvider,
  type WalletState,
} from "./console-wallet";

declare global {
  interface Window {
    ethereum?: ConsoleProvider;
  }
}
const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;
class ConsoleUiError extends Error {}

export function useConsole() {
  const session = useRef("");
  const provider = useRef<ConsoleProvider | null>(null);
  const unobserve = useRef<(() => void) | null>(null);
  const working = useRef(false);
  const workspaceRef = useRef<Workspace>({ ...emptyWorkspace });
  const historyRef = useRef<FlowView[]>([]);
  const journalRequest = useRef<Promise<void> | null>(null);
  const liveRequest = useRef<Promise<void> | null>(null);
  const clockOffset = useRef(0);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [journal, setJournal] = useState<ConsoleJournal | null>(null);
  const [status, setStatus] = useState<ConsoleStatus | null>(null);
  const [history, setHistory] = useState<FlowView[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>({ ...emptyWorkspace });
  const [journalError, setJournalError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [busy, setBusy] = useState("");
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [walletState, setWalletState] = useState<WalletState>({
    account: "",
    chainId: "",
  });
  const [fundingHash, setFundingHash] = useState("");

  const persist = useCallback((update: (w: Workspace) => Workspace) => {
    let current: Workspace;
    try {
      current = restoreWorkspace(localStorage.getItem(WORKSPACE_KEY));
    } catch {
      const message =
        "本机恢复记录不可用，已暂停新签名与交易；不要清空记录后重发。";
      setStorageError(message);
      throw new ConsoleUiError(message);
    }
    const next = update(current);
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next));
      workspaceRef.current = next;
      setWorkspace(next);
      return next;
    } catch {
      const message =
        "本机恢复记录不可用，已暂停新签名与交易；不要清空记录后重发。";
      setStorageError(message);
      throw new ConsoleUiError(message);
    }
  }, []);
  const acceptFlows = useCallback(
    (incoming: FlowView[]) => {
      const merged = mergeHistory(historyRef.current, incoming);
      historyRef.current = merged;
      setHistory(merged);
      persist((w) => {
        const selectedId = w.selectedId ?? merged[0]?.id ?? null;
        const selected = merged.find((f) => f.id === selectedId);
        return {
          ...w,
          selectedId,
          draft:
            w.draft ??
            (selected ? (selected.proposedValueBps / 100).toFixed(2) : null),
          pending: reconcilePending(w.pending, merged),
        };
      });
    },
    [persist],
  );
  const api = useCallback(
    <T>(action?: string, extra: Record<string, unknown> = {}) =>
      consoleRequest<T>(session.current, action, extra),
    [],
  );
  const loadJournal = useCallback((): Promise<void> => {
    if (journalRequest.current) return journalRequest.current;
    setLoadingJournal(true);
    const request = consoleRequest<ConsoleJournal>(
      session.current,
      undefined,
      {},
      "journal",
    )
      .then((next) => {
        clockOffset.current = next.readAt - Math.floor(Date.now() / 1000);
        setJournal(next);
        acceptFlows(next.history);
        setJournalError("");
      })
      .catch((e: Error) => {
        setJournalError(e.message);
      })
      .finally(() => {
        setLoadingJournal(false);
        journalRequest.current = null;
      });
    journalRequest.current = request;
    return request;
  }, [acceptFlows]);
  const loadLive = useCallback((): Promise<void> => {
    if (liveRequest.current) return liveRequest.current;
    setLoadingLive(true);
    const request = api<ConsoleStatus>()
      .then((next) => {
        setStatus((previous) =>
          !previous || next.checkedAt >= previous.checkedAt ? next : previous,
        );
        acceptFlows(next.history);
        setLiveError("");
      })
      .catch((e: Error) => {
        setLiveError(e.message);
      })
      .finally(() => {
        setLoadingLive(false);
        liveRequest.current = null;
      });
    liveRequest.current = request;
    return request;
  }, [api, acceptFlows]);
  const load = useCallback(async () => {
    // A slow live check never delays showing the durable journal.
    await Promise.all([loadJournal(), loadLive()]);
  }, [loadJournal, loadLive]);
  const bindWallet = useCallback((p: ConsoleProvider) => {
    if (provider.current === p) return;
    unobserve.current?.();
    provider.current = p;
    unobserve.current = observeWallet(p, (patch) =>
      setWalletState((w) => ({ ...w, ...patch })),
    );
  }, []);

  useEffect(() => {
    const readSession = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get(
        "session",
      );
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        sessionStorage.setItem("paramshield-session", token);
        window.history.replaceState(null, "", window.location.pathname);
      }
      session.current = sessionStorage.getItem("paramshield-session") ?? "";
    };
    const initialize = window.setTimeout(() => {
      try {
        readSession();
        // Migrate the old selection, but never copy the session secret to localStorage.
        if (!localStorage.getItem(WORKSPACE_KEY)) {
          const selected = sessionStorage.getItem("paramshield-flow");
          localStorage.setItem(
            WORKSPACE_KEY,
            JSON.stringify({ ...emptyWorkspace, selectedId: selected }),
          );
        }
        const saved = restoreWorkspace(localStorage.getItem(WORKSPACE_KEY));
        workspaceRef.current = saved;
        setWorkspace(saved);
        setFundingHash(
          localStorage.getItem("paramshield-funding-hash") ??
            sessionStorage.getItem("paramshield-funding-hash") ??
            "",
        );
      } catch {
        setStorageError(
          "本机恢复记录不可用，已暂停新签名与交易；不要清空记录后重发。",
        );
      }
      setAuthenticated(Boolean(session.current));
      setReady(true);
      setNow(Math.floor(Date.now() / 1000));
      if (session.current) void load();
    }, 0);
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000) + clockOffset.current),
      1000,
    );
    const poll = window.setInterval(() => {
      if (session.current && document.visibilityState === "visible")
        void loadJournal();
    }, 3000);
    const livePoll = window.setInterval(() => {
      if (session.current && document.visibilityState === "visible")
        void loadLive();
    }, 30_000);
    const visible = () => {
      if (session.current && document.visibilityState === "visible")
        void load();
    };
    const discovered = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info: { rdns: string };
          provider: ConsoleProvider;
        }>
      ).detail;
      if (detail?.info.rdns === "io.metamask") bindWallet(detail.provider);
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_KEY) return;
      try {
        const next = restoreWorkspace(event.newValue);
        workspaceRef.current = next;
        setWorkspace(next);
      } catch {
        setStorageError("另一页面的恢复记录不可用；已暂停新签名与交易。");
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (working.current || workspaceRef.current.pending?.phase === "wallet") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const sessionChanged = () => {
      try {
        readSession();
        setAuthenticated(Boolean(session.current));
        if (session.current) void load();
      } catch {
        setError("本机会话无法读取；请使用私有启动链接，不要分享该链接。");
      }
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("hashchange", sessionChanged);
    window.addEventListener("eip6963:announceProvider", discovered);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = window.ethereum;
    const fallback =
      injected?.providers?.find((p) => p.isMetaMask) ??
      (injected?.isMetaMask ? injected : null);
    if (!provider.current && fallback) bindWallet(fallback);
    return () => {
      window.clearTimeout(initialize);
      window.clearInterval(timer);
      window.clearInterval(poll);
      window.clearInterval(livePoll);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("hashchange", sessionChanged);
      window.removeEventListener("eip6963:announceProvider", discovered);
      unobserve.current?.();
      provider.current = null;
    };
  }, [load, loadJournal, loadLive, bindWallet]);

  function beginOperation(kind: PendingOperation["kind"], flowId: string) {
    persist((w) => {
      if (w.pending)
        throw new ConsoleUiError(
          "已有结果待核对的请求；请先读取记录，不要重复操作。",
        );
      return {
        ...w,
        pending: {
          id: crypto.randomUUID(),
          flowId,
          kind,
          phase: "request",
          startedAt: Math.floor(Date.now() / 1000) + clockOffset.current,
          baseRevision:
            historyRef.current.find((f) => f.id === flowId)?.revision ?? 0,
        },
      };
    });
  }
  function patchOperation(
    patch: Partial<Pick<PendingOperation, "phase" | "hash">>,
  ) {
    const id = workspaceRef.current.pending?.id;
    persist((w) => ({
      ...w,
      pending:
        w.pending && w.pending.id === id
          ? { ...w.pending, ...patch }
          : w.pending,
    }));
  }
  function clearOperation(id = workspaceRef.current.pending?.id) {
    persist((w) => ({
      ...w,
      pending: w.pending?.id === id ? null : w.pending,
    }));
  }
  async function task(label: string, fn: () => Promise<void>) {
    if (working.current) return; // Synchronous lock, including double clicks before React renders.
    const previousOperation = workspaceRef.current.pending?.id;
    working.current = true;
    setBusyStartedAt(Math.floor(Date.now() / 1000) + clockOffset.current);
    setBusy(label);
    setError("");
    try {
      if (navigator.locks)
        await navigator.locks.request(
          "paramshield-console-action",
          { ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw new ConsoleUiError(
                "另一个页面正在处理请求；请先核对该页面，不要重复操作。",
              );
            await fn();
          },
        );
      else await fn();
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? e.code : null;
      if (
        rejectedCurrentWalletRequest(
          code,
          workspaceRef.current.pending,
          previousOperation,
        )
      )
        clearOperation();
      setError(
        code === 4001
          ? "你已取消钱包请求；未记录新的签名或交易哈希。"
          : code === -32002
            ? "MetaMask 已有待处理请求；请打开钱包查看，不要重复点击。"
            : e instanceof ConsoleRequestError || e instanceof ConsoleUiError
              ? e.message
              : "钱包请求结果待核对；请检查账号、网络及活动记录，勿重发。",
      );
    } finally {
      working.current = false;
      setBusy("");
      setBusyStartedAt(null);
      if (session.current) void load();
    }
  }
  async function walletFor(expected?: string) {
    const p = provider.current;
    if (!p)
      throw new ConsoleUiError(
        "没有找到 MetaMask，请在 thunderxu 的 Chrome 中打开。",
      );
    let accounts = (await p.request({ method: "eth_accounts" })) as string[];
    if (!accounts.length)
      accounts = (await p.request({
        method: "eth_requestAccounts",
      })) as string[];
    const account = accounts[0] ?? "";
    setWalletState((w) => ({ ...w, account }));
    if (expected && account.toLowerCase() !== expected.toLowerCase())
      throw new ConsoleUiError(
        `请在 MetaMask 切换到 ${short(expected)}；当前为 ${short(account)}。`,
      );
    if ((await p.request({ method: "eth_chainId" })) !== "0xaa36a7")
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    if ((await p.request({ method: "eth_chainId" })) !== "0xaa36a7")
      throw new ConsoleUiError("仅允许 Sepolia。");
    setWalletState((w) => ({ ...w, chainId: "0xaa36a7" }));
    return p;
  }
  function select(f: FlowView) {
    setError("");
    persist((w) => ({
      ...w,
      selectedId: f.id,
      draft: (f.proposedValueBps / 100).toFixed(2),
    }));
  }
  function setThreshold(value: string) {
    persist((w) => ({ ...w, draft: value }));
  }
  async function analyze(value: number) {
    const id = crypto.randomUUID();
    beginOperation("analyze", id);
    persist((w) => ({ ...w, selectedId: id, draft: (value / 100).toFixed(2) }));
    acceptFlows([await api<FlowView>("analyze", { id, thresholdBps: value })]);
  }
  const flow = history.find((f) => f.id === workspace.selectedId) ?? null;
  async function action(
    name: string,
    extra: Record<string, unknown> = {},
    id = flow?.id,
  ) {
    if (!id) return;
    const f = await api<FlowView>(name, { id, ...extra });
    acceptFlows([f]);
    if (f.error) setError(f.error);
  }
  function recordFundingHash(hash: string) {
    localStorage.setItem("paramshield-funding-hash", hash);
    setFundingHash(hash);
    clearOperation();
  }
  return {
    ready,
    authenticated,
    journal,
    status,
    history,
    flow,
    threshold: workspace.draft ?? "70.00",
    pending: workspace.pending,
    selectedId: workspace.selectedId,
    busy,
    busyStartedAt,
    error,
    now,
    account: walletState.account,
    chainId: walletState.chainId,
    storageError,
    liveError,
    journalError,
    loadingJournal,
    loadingLive,
    fundingHash,
    liveFresh: Boolean(status && !liveError && now < status.checkedAt + 60),
    api,
    load,
    loadJournal,
    task,
    select,
    setThreshold,
    analyze,
    action,
    walletFor,
    beginOperation,
    patchOperation,
    clearOperation,
    recordFundingHash,
  };
}
