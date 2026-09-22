# Jev Decision Layer — Avatar CMD v3

## Goal

Introduce TypeSafe Jev as a decision-only layer without replacing the existing generative LLM path.

The first release runs in **shadow mode**: Jev evaluates generated content, but its result does not change publishing behavior. This lets us measure agreement, confidence, latency, and failure modes before enabling autonomous gates.

## Architecture

```
Knowledge / Soul / Analytics / Draft
              |
              v
        State Builder
              |
              v
         Jev Decision
   Choice / Score / Noul
              |
              v
       Shadow Decision Log
              |
              v
 Existing Content / Scheduler flow
```

Later phases can insert a policy engine between the Jev result and execution.

## Phase 0 — Shadow Mode

Implemented in this branch:

- TypeSafe JS SDK pinned to `0.6.0`
- `TYPESAFE_API_KEY` and `JEV_MODEL`
- decision client wrapper
- post review evaluator
- automatic evaluation after post generation
- decision payload stored inside the existing ActivityLog metadata
- Jev failures never break content generation

### Current post questions

1. `action` — Choice: publish / review / hold
2. `personaFit` — Score: poor / acceptable / strong
3. `salesPressure` — Score: low / moderate / high
4. `duplicateRisk` — Noul probability
5. `brandRisk` — Score: low / moderate / high

## Operating rule

Jev must not be used for deterministic facts that code can calculate directly.

Use ordinary code for:

- numeric thresholds
- authentication / authorization
- billing
- destructive operations
- exact scheduling
- hard compliance rules

Use Jev for semantic ambiguity:

- tone fit
- topic duplication
- promotional pressure
- routing
- risk triage
- whether human review is warranted

## Promotion criteria

Do not move from shadow mode to autonomous gating until enough real decisions have been compared against human review.

Suggested metrics:

- human agreement rate
- false-publish rate
- false-hold rate
- review escalation rate
- p50 / p95 latency
- decision API error rate
- cost per 1,000 evaluated posts
- agreement by platform and persona

## Phase 1 — Content Gate

After validation, apply a deterministic policy to the Jev output.

Example policy:

```
hard rule violation -> HOLD
action=hold -> HOLD
action=review -> HUMAN_REVIEW
low action probability -> HUMAN_REVIEW
high brand risk -> HUMAN_REVIEW
otherwise -> PUBLISH
```

Thresholds should live in code/config, not in the Jev prompt.

## Phase 2 — Model Router

Add a Choice decision for:

- deterministic
- lightweight_llm
- creative_llm
- deep_reasoning
- human

The selected target then runs through the existing AI router.

## Phase 3 — Retry Router

Use error state to choose:

- retry_api
- browser_fallback
- wait
- switch_provider
- human_review
- stop

This should complement, not replace, the scheduler's deterministic max-retry safety rule.

## Phase 4 — Knowledge Reranker

Before generation, evaluate whether retrieved KnowledgeItems are relevant enough to send to the generative model.

This reduces prompt size and prevents stale or unrelated context from contaminating generation.

## Phase 5 — Browser Decision Layer

Jev chooses only from a constrained action vocabulary:

- click
- type
- scroll
- open
- back
- wait
- stop
- human

Playwright remains responsible for the actual browser operation.

## Production data model

A dedicated DecisionEvent table is recommended once shadow validation begins at scale.

Suggested fields:

- id
- avatarId
- contentId / jobId
- decisionType
- model
- modelVersion
- schemaVersion
- stateHash
- answers
- selectedAction
- humanAction
- humanOverride
- latencyMs
- usage
- error
- createdAt

Do not persist secrets or raw credentials in decision state.

## Environment

```env
TYPESAFE_API_KEY=
JEV_MODEL=jev-1.13.0
```

Pin a concrete model in production. Use `jev-latest` only when intentionally accepting model drift.

## Validation checklist

- [ ] install dependencies
- [ ] TypeScript build passes
- [ ] no API key -> existing generation still works
- [ ] valid API key -> Jev metadata appears in ActivityLog
- [ ] invalid API key -> error is logged but content is still created
- [ ] compare at least 100 real decisions with human labels
- [ ] define production thresholds from observed errors
- [ ] add Discord escalation before autonomous hold/publish
