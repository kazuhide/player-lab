# Check changes before publishing

Run the existing checks from the repository root:

```sh
pnpm typecheck
pnpm test
pnpm build
bash scripts/test-env-lib.sh
pnpm --filter @showcase/e2e e2e:public
```

The browser subset uses public media and needs installed Chrome locally. CI uses
the Chromium version supplied by the locked Playwright package. Optional hosted
media tests have separate prerequisites in [the browser instructions](../tests/e2e/README.md).

## Before a commit or push

Install Python 3 and [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
Check its version with `gitleaks version`. No account credentials are needed.

```sh
python3 scripts/check-publication.py --staged
python3 scripts/check-publication.py --base origin/main
```

The first command checks the staged files. The second checks the committed tree
and every commit after the base, including secrets added and later removed.
It rejects real environment files, generated credential files, and detected
secret patterns. `.env.example` files remain allowed and their contents are
still scanned. Findings print rule identifiers rather than matched values.

Enable the included local pre-push hook for this checkout:

```sh
git config core.hooksPath .githooks
```

It checks each pushed commit. If a remote base is missing locally, fetch it
before retrying. Hooks can be bypassed and do not replace reviewing the diff,
commit messages, and pull request title and body before publication.

For private literal checks, keep a separate local file outside Git, with one
literal per line. Do not publish that file, the literals, or hashes of them.
Configure its absolute location only in local Git configuration:

```sh
git config publication.privateRules /absolute/path/to/local-rules.txt
```

The checker also accepts `--private-rules` or `PUBLICATION_PRIVATE_RULES`.
It refuses to use tracked rules. It does not print matched literals. This is a
check for known values; it cannot recognize all confidential prose or context.

## CI and publication limits

CI repeats the public rules without private rules or account secrets. Its checks
can be required before merging to `main`. The workflow also tests the checks
with temporary repositories containing dummy values; it never uploads raw
scanner reports.

A push to a public branch is visible before CI runs. Local checks and review
must happen first. [GitHub Push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)
can block supported secret types, but does not identify every confidential name,
URL, or sentence. Neither a green CI result nor an empty scan guarantees that
content is suitable for publication.
