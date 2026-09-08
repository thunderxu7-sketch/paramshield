# Planning and prompt artifacts

This directory is a public, sanitized planning record. The local working
`PLAN.md` stays ignored as requested; [its full public copy](PLAN.md) is
committed here, not replaced with a short summary.
[The execution checklist](../implementation-plan.md) and
[accepted ADR](../decisions/0001-risk-and-execution-boundaries.md) govern the
September 7 revision. Earlier committed specs remain available in git history.

## Available material user directions (verbatim excerpts)

These excerpts are from the visible project conversation, not a fabricated full
transcript. Chinese directions are retained rather than silently translated.

- “好的, 确定方向2, 评估一下现在的方案”
- “一个 Demo Lending Market … The Graph 实时数据 … Chainlink Confidential
  Workflow … 危险交易阻断 … Privy 审批与真实测试网交易 … Before/After 证据报告”
  (Excerpted from the user's 13-item scope; the full list is below.)
- “先列一个完整的计划, 加入到 ignore 中”
- “review 一下当前的规划是否合理? 是否有需要完善的地方”
- “好的, 按照你的建议依次执行” — authorizes the accepted September 7 revisions.
- “连接状态有点问题” / “分析一下原因, 以及是否有其他备选方案” — requests
  diagnosis of the Studio/MetaMask login problem.
- “好的, 依次执行” / “continue” — continues the agreed outage fallback and
  integration work, not a request to lower risk controls or relabel local data.

### User's original feature list

1. 一个 Demo Lending Market
2. 一种参数修改
3. 一种压力情景
4. The Graph 实时数据
5. Chainlink Confidential Workflow
6. 危险交易阻断
7. Privy 审批与真实测试网交易
8. Before/After 证据报告
9. 2–4 分钟 Demo 视频
10. AI 自动解释风险
11. 推荐安全参数
12. 第二种风险场景
13. 历史事故回放

The revised scope promotes evidence-grounded AI to P0 and defers items 12–13.
The ADR records the assistant's implementation direction approved by the user:
incremental exposure, confidential bounded search, acyclic evidence, state/epoch
checks, explicit simulated CRE/trusted-relay mode, early live sponsor controls,
and freeze-before-video scheduling. Tests are generated against these
invariants.

## Completeness and redaction

This is the available material prompt/spec/plan record, **not a claim that every
historical model exchange has been exported**. Before submission, reconcile any
additional actual prompts/plans used, including runtime model instructions and
workflow configs, and commit them. Do not reconstruct missing messages as exact
quotes. Redact credentials, account identifiers, personal browser context, and
unrelated private projects; record redaction categories without publishing their
values. No private pre-event project implementation is imported into this repo.

## September 7 outage implementation record

The agreed implementation sequence was a local Graph development fallback,
real-chain reconciliation, product CRE CLI integration and signing preparation,
while retaining hosted Studio as the submission path. The fallback, handler,
runner, tests and pre-sign checks were AI-assisted. Goldsky remains conditional;
no alternate account or unreviewed v2 transaction was created. The complete plan
records verified versus pending gates; unit mock adapters and a CLI simulation
are not represented as production identity checks or a hardware TEE.

## September 8 implementation direction

The user asked “今天的任务是什么?” and then authorized “好的,依次执行”. The
agreed sequence was Studio recovery verification, separate v2 deployment
preparation, real RPC/review adapters, CRE-to-Privy signing integration with
timeout/duplicate checks, and relevant verification/documentation/commits. This
authorized work, not automatic replacement of v1 or acceptance of new service
terms. The implementation and tests in the server-only relay, deployment
preparation and isolated integration harnesses were AI-assisted. The actual
limitations and pending role/deployment/hosted gates are recorded in
[the execution service](../execution-service.md). No real human review, TEE,
organization quorum or public Sepolia execution is inferred from test results.

### Studio recovery continuation

The user then answered “确认” to the specific Studio wallet-connection and terms
prompt, and “解锁了” after a host-lock interruption. The existing event wallet
was reconnected; a separate v1 Studio subgraph was created/deployed and its
hosted read corroborated against RPC. These instructions did not authorize a
public-network publication transaction or v2 deployment. Credential and
account-specific query configuration remain local and ignored; the public record
includes source hashes, deployment CID and sanitized live evidence.

### Wallet funding and candidate preparation continuation

The user supplied two MetaMask addresses and requested testnet funding followed
by continued work. After a faucet account limit, the user explicitly replied
“允许操作” to the proposed 0.05 Sepolia ETH transfer from the existing admin to
the second address. That transfer was independently verified through RPC; it was
not a second faucet claim or a guarded product execution. Personal account
addresses and funding receipts remain in ignored local records.

The continuation preserves MetaMask private keys and the two earlier isolated
Privy proof wallets. A dedicated operator candidate starts with an unconditional
deny policy, rather than treating an external MetaMask account as a
Privy-managed signer. Candidate creation does not authorize live role
assignment, policy activation, v2 deployment, or an assertion of independent
organization governance. The public deployment evidence distinguishes these
remaining gates.

### Explicit v2 deployment authorization

The user then confirmed: “确定上述分工 → 部署预演 → 审阅并发送 v2 部署交易”.
This authorizes the selected admin/operator/authority topology, offchain
reviewer selection, the new Sepolia deployment and its verification, while
preserving v1 and the locked Privy policy. It supersedes the earlier deployment
pause; final human-review integration and executable Privy policies are
activation gates, not prerequisites to constructing a locked deployment.

The implementation used the compiled public BootstrapV2, a read-only Foundry
rehearsal, a local single-attempt MetaMask helper and independent
post-transaction RPC/source verification. The helper, private resource IDs,
reviewer address and funding records stay local. Only contract-role addresses
necessarily made public by the deployment and sanitized verification records are
published. No product execution, reviewer signature, TEE or organization quorum
is claimed.
