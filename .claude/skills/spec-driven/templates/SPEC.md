# Spec: [Project / Feature Name]

> **Purpose**: The implementation blueprint. Precise enough that Claude can build a
> section from it without asking clarifying questions. Every section should answer:
> "what exactly gets built?"
>
> **How to use**: Feed a section to Claude with:
> _"Read SPEC.md section [N]. Implement it."_
> Or feed the whole thing:
> _"Read SPEC.md and implement the [component] section."_

---

## Overview

[1–2 paragraphs: what does this system do, drawn from the brief. Written for Claude,
not for a board — just enough context to implement confidently.]

## Tech alignment

> _Remove this section if the project is standalone (a script, a CLI, a local tool).
> Keep and fill it in if this integrates with the personal website._

| Layer | Choice | Notes |
|-------|--------|-------|
| Backend runtime | Cloudflare Worker (JS edge) | No Node.js built-ins |
| Database | Cloudflare D1 (SQLite) | See data models below for DDL |
| Object storage | Cloudflare R2 | Key pattern: `[prefix]/{filename}` |
| Frontend framework | React 18 + TypeScript | |
| UI components | shadcn/ui + Tailwind | Check shadcn before building custom |
| Server state | TanStack Query v5 | `useQuery` / `useMutation` |
| Forms | React Hook Form + Zod | Zod schema shared with Worker validation |
| New route URL | `/[path]` | React Router v6 entry needed |

## Architecture

[High-level picture: what are the main components and how do they relate? A simple
list or ASCII diagram works well here. For website integrations, start from the
Cloudflare edge layer and work inward.]

```
[e.g. for a website feature]
Browser → /api/things (Worker handler)
              └── D1: SELECT * FROM things WHERE user_id = ?
              └── R2: signed URL for attachments

[e.g. for a standalone tool]
CLI entry point
  └── config loader   (reads/writes config.json)
  └── processor       (core logic)
      └── output formatter
```

## Data models

[Key data structures. For D1/SQLite integrations: include CREATE TABLE DDL and the
TypeScript interface that maps to each row. For Python: dataclasses or TypedDicts.]

```sql
-- D1 example
CREATE TABLE things (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```ts
// TypeScript row type
interface ThingRow {
  id: number;
  name: string;
  created_at: string;
}
```

## Interfaces

[The entry points into the system. For Worker APIs: each endpoint as method + path +
request/response shape. For CLIs or libraries: function signatures with types.]

```ts
// Worker API endpoint example
// GET /api/things/:id
// Auth: Bearer token required
// Response 200: { thing: ThingRow }
// Response 404: { error: 'not_found' }
// Response 401: { error: 'unauthorized' }
```

```python
# Python CLI/library example
def process(input_path: Path, output_path: Path, *, dry_run: bool = False) -> Result:
    """
    Process input_path and write results to output_path.
    Returns Result with .success bool and .errors list[str].
    Raises FileNotFoundError if input_path doesn't exist.
    """
```

## Behaviour

[Walkthrough of the main flow. What happens, in what order, for the happy path and
key error paths. Numbered steps work well here.]

1.
2.
3.

**Error cases:**

| Situation | Behaviour |
|-----------|-----------|
| | |

## Acceptance criteria

[Testable conditions that must pass for each component to be "done". Written as
assertions or observable behaviours, not vague goals.]

- [ ]
- [ ]
- [ ]

## Out of scope

[Explicitly excluded from this spec — things that are deliberately deferred or belong
in a future version.]

-
-
