# Echo Format Reference

An Echo is a materialized conversation — a living artifact with editorial voice, aesthetic judgment, and creative synthesis. Stored as markdown with YAML frontmatter.

## The Skeleton

Every echo follows a universal structure. Sections are named by **function**, not activity — "The Counter" works for a literary review as naturally as for a technical analysis.

| Section | Role | quick | standard | deep |
|---------|------|:---:|:---:|:---:|
| **The Claim** (title) | Editorial position, not a headline | yes | yes | yes |
| **The Tension** (subtitle) | Why now — the stakes, the time pressure | yes | yes | yes |
| **The Take** | 2-4 sentence synthesis. The position before the evidence. | yes | yes | yes |
| **The Evidence** | Material organized by signal strength, cross-referenced | — | yes | yes |
| **The Counter** | What complicates the position. What would make this wrong. | — | yes | yes |
| **The Map** | Cross-domain connections, unexpected adjacencies | — | — | yes |
| **The Edge** | Unresolved questions, what to watch, where this is heading | — | yes | yes |

## Structure

```markdown
---
id: echo-m4x7k9
status: draft
title: "Editorial Claim Title"
subtitle: "One line on why it matters now"
createdAt: "2026-02-26T14:30:00Z"
updatedAt: "2026-02-26T14:30:00Z"
tags: [concept-a, concept-b]
categories: [general, tweet, research paper]
sources:
    - url: "https://..."
      title: "Source Title"
      type: paper
      domain: arxiv.org
      category: research paper
    - url: "https://..."
      title: "Source Title"
      type: x-post
      domain: x.com
      category: tweet
---

The Take — 2-4 sentences of editorial synthesis. Your position
before the evidence. Uses [[wikilinks]] for key concepts.

<!-- deep-dive -->

## The Evidence

Material organized by signal strength, not source-by-source.
Cross-referenced across categories for strongest signals.

## The Counter

What complicates the position. The strongest version
of the opposing read.

## The Map

(deep only) Cross-domain connections, unexpected adjacencies.
The synthesis no single source contains.

## The Edge

Unresolved questions, what to watch, where this is heading.
The reader leaves with better questions.
```

## How sections adapt across domains

The skeleton is universal — the *content* inside each section adapts to the domain.

**Tech/Engineering:**
- The Evidence → implementations, benchmarks, architecture comparisons, git histories
- The Counter → scaling limits, adoption friction, competing standards

**Literary/Creative:**
- The Evidence → close reading, aesthetic comparison, influence tracing, reception history
- The Counter → the reading that challenges yours, the context you might be missing

**Finance/Business:**
- The Evidence → filings, earnings data, market positioning, cap table dynamics
- The Counter → bear case, regulatory risk, competitive moat erosion

**Sports/Culture:**
- The Evidence → performance data, tactical analysis, historical parallels
- The Counter → sample size problems, confounding variables, narrative bias

## Status values

- `draft` — private, only accessible with private key
- `published` — public, visible in the LORE graph feed

## Source types

- `article` — blog posts, web articles
- `paper` — academic papers (arxiv, OpenReview, etc.)
- `x-post` — tweets/threads from X/Twitter
- `news` — news articles
- `company` — company pages, about pages
- `person` — people profiles (LinkedIn, etc.)
- `financial` — SEC filings, investor reports
- `personal-site` — practitioner blogs, personal sites
- `other` — everything else

## Source categories

Each source includes the Exa category that produced it:

- `general` — uncategorized web search
- `tweet` — X/Twitter posts and threads
- `research paper` — academic papers
- `news` — news articles
- `personal site` — practitioner blogs
- `financial report` — SEC filings, investor reports
- `company` — company pages

Cross-category signal is the strongest signal — when a paper, a tweet thread, and a news article all point to the same idea, that's convergence worth leading with.
