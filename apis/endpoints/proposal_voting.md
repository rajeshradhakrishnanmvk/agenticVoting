---
type: REST API Endpoint
title: Cast Priority Vote Spec
description: Details of POST /api/v1/proposals/{id}/vote used to cast priority ballots and flip votes dynamically.
resource: /api/v1/proposals/{id}/vote
tags: [apis, voting, priority-weights]
timestamp: 2026-06-19T00:25:00-07:00
---

# REST Endpoint: Cast Priority Vote

Registers or updates priority votes on a specific proposal. The backend handles vote updates transactionally to enforce limits and prevent duplicate voting.

- **URL Path**: `/api/v1/proposals/{id}/vote`
- **Supported Methods**: `POST` (Cast ballot)

---

## 🛠️ POST Method: Vote Submission

Submits an upvote or downvote. To prevent spam, accounts are rate-limited to 100 votes per day.

- **Security Requirements**: Basic Auth or Custom Headers.
- **Request Body Content-Type**: `application/json`

### Body Properties
- `direction` (`String`, Required): The choice direction. Enums: `up` (upvote), `down` (downvote)

```json
{
  "direction": "up"
}
```

### Success Response (`200 OK`)
Returns the updated vote totals and the proposal's active status.

```json
{
  "success": true,
  "data": {
    "upvotesCount": 5,
    "downvotesCount": 1,
    "netVotes": 4,
    "status": "active"
  }
}
```

### Error Responses
- `429 Too Many Requests`: Rating limits exceeded (more than 100 votes per day).
- `401 Unauthorized`: Authentication credentials rejected.
- `404 Not Found`: No proposal matches the requested `{id}` path parameter.

---

## 🧬 Core Voting Logic & Invariants

```
                            [POST /vote Action]
                                     │
                             (Identity Check)
                      Does userId match auth session?
                                 ├── No ──► [401 Unauthorized]
                                 └── Yes
                                     │
                             (Checks Rate Limit)
                      Under 100 votes cast today?
                                 ├── No ──► [429 Too Many Requests]
                                 └── Yes
                                     │
                       (Writes nested /votes/{userId})
                       Updates vote doc and recalculates:
                  netVotes = upvotesCount - downvotesCount
                                     │
                   (Updates Master Proposal & Reputation)
```

---

## 🧭 Directory Connections
- 🔌 **[Back to API Index](../index.md)**
- 🗳 *[Proposal Votes Dataset Details](../../database/tables/votes.md)*
- 🏠 **[Return to KB Master Index](../../index.md)**
