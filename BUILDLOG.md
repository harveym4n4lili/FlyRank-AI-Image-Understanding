# Build Log

An honest log of the build: what was done, where AI helped, where it was wrong, and what I changed.

## 2026-10-09 · Phase 0 + planning

**Done:** read the brief; wrote the planning docs (design, spec, guard and eval plan, roadmap); set up the
repo, TypeScript/Express/Drizzle/pg-boss skeleton, Docker Compose (Postgres + pgvector, api, worker),
lint and tests.

**Where AI helped:** Claude Code drafted the planning docs from the brief and generated the project
skeleton (env validation, error handling, health route, Dockerfile, compose file, first tests).

**Where AI was wrong or needed correcting:**
- The first docs draft was split into 8 files, which was too fragmented. I asked for them to be merged into 4.
- It assumed Docker Desktop lived in `C:\Program Files`. Mine is a per-user install, so it had to find the real path.
- The docs said Node 20; updated to Node 24 to match the installed LTS.

**What I need to be able to explain:** why `subject_label` exists in addition to `subject` (see
docs/GUARD_AND_EVAL.md), and why the app is built with `createApp(deps)` (so tests run without a database).
