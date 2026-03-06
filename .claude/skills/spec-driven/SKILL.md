---
name: spec-driven
description: >
  Guide the user through spec-driven development by creating four living documents
  that serve as executable Claude prompts: BRIEF.md (problem + goals), RESEARCH.md
  (open questions to resolve before speccing), SPEC.md (detailed implementation
  blueprint), and PLAN.md (phased execution roadmap).

  Use this skill whenever the user wants to plan, design, or think through something
  before writing code — even if they don't use the word "spec". Trigger on phrases
  like: "I want to build X", "help me design this feature", "where do I start on Y",
  "let's think this through", "I need to spec this out", "help me plan this project",
  "what should I build first", or any time someone describes a problem they want to
  solve with software. Jump in early — the best time to use this skill is before a
  single line of code is written.
---

# Spec-Driven Development Skill

Each document in this workflow is a **baton pass**: it's written to be handed back to
Claude in a future session as a self-contained prompt. Keep them lean and actionable —
not boilerplate graveyards, but living documents that can drive implementation.

## The workflow

```
BRIEF.md → (RESEARCH.md) → SPEC.md → PLAN.md
```

- **BRIEF.md** — *What* are we building and *why*? The north star.
- **RESEARCH.md** — Open questions that must be resolved before the spec can be written. Optional but often needed.
- **SPEC.md** — *How* are we building it? Precise enough to implement from.
- **PLAN.md** — *When* and *in what order*? Phased, each phase is a Claude session prompt.

Start with the BRIEF and let what you learn there determine whether RESEARCH is needed
before moving to the SPEC.

## Stack profile

If the project is intended to integrate with or be deployed to Joe's personal website,
load `references/stack.md` before writing the Architecture, Data Models, and Interfaces
sections of the SPEC. The stack profile describes the existing platform (Cloudflare
Workers + D1 + R2, React + shadcn/ui + TanStack Query) and contains concrete guidance
on how each technology shapes spec decisions — what DDL looks like for D1, how Worker
API endpoints are structured, which UI components to reach for first, and so on.

Use the stack profile to make decisions that will work with the existing system rather
than creating new patterns the site will have to accommodate. If the project is
standalone (a local script, a CLI, something unrelated to the site), the stack profile
doesn't apply — don't force Cloudflare or React patterns onto it.

---

## Step 1: Create BRIEF.md

The brief is a short, opinionated document that captures the *problem space* — not the
solution. Its job is to align you and Claude on what matters before any design decisions
are made.

### Interview process

Don't dump a blank template. Ask questions and fill in the brief together. A minimal
interview covers:

1. **Problem**: What problem are you solving? Whose problem is it?
2. **Goals**: What does success look like? (2–4 concrete goals, not "it works")
3. **Non-goals**: What are you explicitly NOT doing? This is just as important as goals.
4. **Constraints**: What are you working within? (existing system, language, time, team size)
5. **Open questions**: What don't you know yet that might change the design?

If the user has already described the project in their message, extract what you can and
ask only what's missing. Don't re-ask things already answered.

### Brief template

See `templates/BRIEF.md` for the template. Fill it in as you go — don't present the
blank template and ask them to fill it out themselves.

**Target length: under 300 words.** A brief that runs longer has almost certainly drifted
into spec territory. If you notice yourself writing data models, function signatures,
file structures, or technology choices, stop — those belong in the SPEC. The brief
answers *what* and *why*, never *how*. When in doubt, cut a section rather than expand
it; the spec will fill in the gaps.

### After the brief

Look at the "Open Questions" section. If there are real unknowns that would change how
you design the spec (e.g., "should this be a CLI or a web app?", "what does the existing
data look like?"), create RESEARCH.md. If the path is clear, go straight to SPEC.md.

---

## Step 2: Create RESEARCH.md (optional)

Research is for resolving decisions that would make the spec ambiguous without answers.
Use it when there are genuine forks in the road — technology choices, unknown data shapes,
integration constraints.

Keep it focused: list the questions, do the research (web search, reading docs, asking
the user), record findings, then commit to a decision with reasoning.

See `templates/RESEARCH.md` for the template.

When research is complete, fold the decisions back into the brief if they affect scope,
then move to the spec.

---

## Step 3: Create SPEC.md

The spec is the implementation blueprint. It should be precise enough that Claude can
implement a section of it without asking clarifying questions. Think of it as a prompt
that says: "Build exactly this."

### Interview process

The brief gives you the *what* and *why*. The spec interview fills in the *how*:

1. **Architecture**: What are the main components? How do they relate?
2. **Data models**: What are the key data structures, schemas, or types?
3. **Interfaces**: What are the entry points? (function signatures, CLI commands, API endpoints, UI flows)
4. **Acceptance criteria**: What does "done" look like for each part? What must pass?
5. **Error handling**: What happens when things go wrong?

For each section, ask targeted questions rather than open-ended ones. "Will this need
to persist data? If so, where — a file, a database, in memory?" is better than "what
about storage?"

### Spec template

See `templates/SPEC.md`. Write one section at a time — don't try to fill everything at
once. Iterate with the user until each section is concrete.

### What a good spec section looks like

**Too vague**: "Users can log in"

**Good**: "Auth is handled via JWT. `authenticate(username, password) -> Token | None`.
Token payload: `{user_id: str, exp: int}`. Tokens expire after 24h. Invalid credentials
return `None`, not an exception."

### After the spec

Check: could you hand this spec to a competent developer (or Claude) and have them build
it without asking you questions? If yes, move to PLAN.md. If no, keep iterating.

---

## Step 4: Create PLAN.md

The plan breaks the spec into phases. Each phase should be:
- **Self-contained**: it has a clear deliverable
- **Ordered by dependency**: phase 2 can start where phase 1 ends
- **Sized for a session**: a few hours of work, not weeks

Each phase includes a **session prompt** — the exact text to paste into a new Claude
session to kick off that phase. This is what makes the plan executable.

### Phase session prompt format

```
Read BRIEF.md and SPEC.md.

Implement Phase N: [Name]

Goal: [what this phase achieves]
Deliverables: [specific files or outputs]
Start from: [what already exists]
```

See `templates/PLAN.md` for the full template.

---

## General principles

**Documents are prompts, not documentation.** Write them to be read by Claude, not to
satisfy a process. Every section should earn its place by helping Claude build the right
thing.

**Lean beats complete.** A focused two-page spec beats a comprehensive ten-page one.
If a section doesn't change what gets built, cut it.

**Explicit non-goals prevent scope creep.** Whenever the user says "and also maybe...",
ask: is that in scope for this spec, or is it a non-goal? Get it on paper.

**Name the decision, record the reasoning.** When a choice is made (in research or the
spec itself), note *why* — not just what was decided. Future-you-reading-this-with-Claude
will thank you.

**When to stop.** You don't need all four documents for every project. A small script
might only need a brief + spec. A well-understood feature might skip research. Use
judgment: the goal is enough clarity to implement confidently, not document completeness.
