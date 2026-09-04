import { projectMetadata } from "@paramshield/shared";

const integrations = [
  {
    name: "The Graph",
    purpose: "Live market positions and parameter history",
  },
  {
    name: "Chainlink CRE",
    purpose: "Confidential policy evaluation",
  },
  {
    name: "Privy",
    purpose: "Policy-bound wallet approval",
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-12 sm:px-10 lg:px-16">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-300 font-black text-slate-950">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight">
              {projectMetadata.name}
            </span>
          </div>
          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
            ETHOnline 2026
          </span>
        </header>

        <section className="grid gap-12 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">
              Preflight control plane for DeFi
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-7xl">
              Stop unsafe parameter changes before they reach the chain.
            </h1>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-base leading-7 text-slate-300">
            ParamShield binds live positions, deterministic stress tests,
            confidential policy, approval, and execution into one verifiable
            evidence trail.
          </div>
        </section>

        <section
          aria-label="Core integrations"
          className="grid gap-4 md:grid-cols-3"
        >
          {integrations.map((integration, index) => (
            <article
              className="rounded-2xl border border-white/10 bg-slate-900/70 p-6"
              key={integration.name}
            >
              <span className="text-xs font-bold tracking-[0.18em] text-slate-500">
                0{index + 1}
              </span>
              <h2 className="mt-8 text-xl font-semibold text-white">
                {integration.name}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {integration.purpose}
              </p>
            </article>
          ))}
        </section>

        <footer className="flex flex-col gap-2 border-t border-white/10 pt-5 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Building from scratch</span>
          <span>Fail closed · Evidence first · Human approved</span>
        </footer>
      </div>
    </main>
  );
}
