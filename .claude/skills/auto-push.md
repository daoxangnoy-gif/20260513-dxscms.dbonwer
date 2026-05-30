# auto-push

After finishing any code change, automatically run the following steps in order:

1. `git add .` — stage all changed files (but never include .env or secrets)
2. `git commit` — write a clear, concise commit message describing what changed and why
3. `git push origin main` — push to GitHub

## Commit message rules
- First line: short summary in English (imperative mood), max 72 chars
- If the change is complex, add a blank line then bullet points explaining details
- Always end with: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## When to run
Run this automatically at the end of every task that modifies files — do not wait for the user to ask separately.

## When NOT to run
- If the user explicitly says "don't push yet" or "just save locally"
- If there are no changes to commit (`git status` is clean)
- If the commit fails (fix the issue first, then push)
