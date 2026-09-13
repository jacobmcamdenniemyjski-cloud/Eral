# Contributing to Earl

Do not develop directly on `main`.

## Workflow

1. Update your local copy of `main`.
2. Create a focused branch, such as `fix/queue-cancellation`.
3. Make one coherent change.
4. Add or update automated tests.
5. Run `npm test`.
6. Push the branch and open a pull request.
7. Wait for CI and review before merging.

```cmd
git checkout main
git pull
git checkout -b feature/short-description
npm test
git push -u origin feature/short-description
```

Keep experiments outside `src/`. Production skills belong in their capability folder and must remain callable independently of chat commands so the future planner can reuse them.
