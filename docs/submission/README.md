# Submission kit — prepared, not submitted

**Prepared September 11, 2026:** R-12 documentation and tooling brought forward
from September 12. Existing live verification remains paused. No wallet action,
public deployment, repository push, upload or dashboard submission is performed
by this kit.

## Read in this order

1. [Judge quickstart](judge-quickstart.md): inspect and reproduce the public
   deterministic example without any wallet or credentials.
2. [Project description](project-description.md): factual English form copy,
   architecture, differentiators, limitations and contribution disclosure.
3. [Sponsor applications](sponsor-applications.md): three selected partner
   categories, source/evidence mapping, truthful feedback and missing proof.
4. [Demo script](demo-script.md): target 3:40 recording, exact screen/action
   plan and English narration for the human presenter.
5. [Rules and gates](rules-and-gates.md): official sources rechecked September
   11, separate submission and internal acceptance conditions.
6. [Planning record](../planning/README.md): complete sanitized plan, available
   material prompts, runtime instructions and explicit history limitations.

## Offline package check

From the repository root:

```sh
pnpm --dir apps/web exec tsx scripts/submission-check.ts
# Stricter inventory gate: exit 2 while any external evidence is pending.
pnpm --dir apps/web exec tsx scripts/submission-check.ts --require-evidence
```

The [manifest](manifest.json) lists public artifacts and outstanding evidence.
The checker hashes only those files, rejects private paths/symlinks, checks
ordinary inline Markdown file links and a small set of secret patterns. It does
not copy private data, fetch URLs, call providers, sign, publish or submit. Exit
0 means the local package structure is valid, **not that the project is ready
for submission**. Even fully recorded gates need independent review;
`submissionReady` intentionally remains false. This is not an exhaustive secret
scanner, remote-link test or Markdown-anchor validator.

## 今日完成与仍需处理

- 本地完成：文档、三个 Sponsor 说明草稿、分镜/英文讲稿、复现入口、提交材料清单及校验工具。
- 仍需处理：[原有待办](../todo-2026-09-11.md)中的真实执行、Graph
  AFTER、AI 与安全托管；以及真人讲解、最终素材检查、公开最新源码和正式提交。
- 不能替代：9.10 的三轮本地 Anvil 复演不是三轮真人浏览器/Privy/Sepolia 验收。
- `demoUrl`、`videoUrl` 目前留空；不得填本机私有控制台会话或虚构地址。
- 本地开发新增源码需要按实际工作拆分、审阅后正常提交；不补造日期、不压成伪历史、不自动推送。

## Hand-off order

Reconcile known hashes → fresh real controlled execution → indexed AFTER and AI
proof → safe hosting/repeat runs → human recording → review artifact inventory
and prompt completeness → publish reviewed source/media → confirm dashboard
fields and partner selections → submit and retain confirmation.

Descriptions stay explicitly qualified until evidence closes the corresponding
gate. A passing JSON inventory cannot replace any step above.
