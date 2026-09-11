export type ConsoleProvider = {
  isMetaMask?: boolean;
  providers?: ConsoleProvider[];
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};
export type WalletState = { account: string; chainId: string };
export function observeWallet(
  p: ConsoleProvider,
  update: (patch: Partial<WalletState>) => void,
) {
  let disposed = false,
    accountsRevision = 0,
    chainRevision = 0;
  const accounts = (value: unknown) => {
    accountsRevision++;
    if (!disposed)
      update({
        account:
          Array.isArray(value) && typeof value[0] === "string" ? value[0] : "",
      });
  };
  const chain = (value: unknown) => {
    chainRevision++;
    if (!disposed) update({ chainId: typeof value === "string" ? value : "" });
  };
  const disconnect = () => {
    accounts([]);
    chain("");
  };
  p.on?.("accountsChanged", accounts);
  p.on?.("chainChanged", chain);
  p.on?.("disconnect", disconnect);
  // Passive reads only; opening/reloading the console must not open MetaMask.
  void p
    .request({ method: "eth_accounts" })
    .then((v) => {
      if (!accountsRevision) accounts(v);
    })
    .catch(() => {
      if (!accountsRevision) accounts([]);
    });
  void p
    .request({ method: "eth_chainId" })
    .then((v) => {
      if (!chainRevision) chain(v);
    })
    .catch(() => {
      if (!chainRevision) chain("");
    });
  return () => {
    disposed = true;
    p.removeListener?.("accountsChanged", accounts);
    p.removeListener?.("chainChanged", chain);
    p.removeListener?.("disconnect", disconnect);
  };
}
