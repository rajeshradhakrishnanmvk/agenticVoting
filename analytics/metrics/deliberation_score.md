---
type: Metric
title: Deliberation Score Metric Spec
description: Mathematical formulation and code logic of goBodhi's dynamic proposal Deliberation Heat Score.
tags: [analytics, metrics, scoring, algorithms]
timestamp: 2026-06-19T00:25:00-07:00
---

# Scoring Metric: Deliberation Score

The **Deliberation Score** ($S_{\text{delib}}$) measures the discussion quality of a proposal over time. While net votes capture baseline popularity, the deliberation score highlights active, high-quality, long-form debate.

---

## 🧮 Mathematical Formulation

The formulation balances thread size (comment count), reply quality (comment upvotes), and decay factors (time passed):

$$S_{\text{delib}} = \frac{C \times Q_{\text{avg}}}{H_{\text{active}}}$$

Where:
- $C$: Total comment count logged on the target proposal.
- $Q_{\text{avg}}$: Average quality multiplier of comment threads, calculated as:
  $$Q_{\text{avg}} = \max\left(0.5, \overline{V}_{\text{net}} + 1\right)$$
  - $\overline{V}_{\text{net}}$: Average net votes across all comments in the thread:
    $$\overline{V}_{\text{net}} = \frac{\sum_{i=1}^{C} (\text{Comment } \text{Upvotes}_i - \text{Comment } \text{Downvotes}_i)}{C}$$
- $H_{\text{active}}$: Total active hours elapsed since creation, calculated as:
  $$H_{\text{active}} = \max\left(0.1, \frac{T_{\text{now}} - T_{\text{createdAt}}}{3.6 \times 10^6 \text{ ms}}\right)$$

---

## 💻 Technical Implementation Example

From our React `App.tsx` metrics memoizer hook:

```typescript
const proposalsWithMetrics = useMemo(() => {
  return proposals.map((p) => {
    const propComments = comments.filter((c) => c.proposalId === p.id);
    const count = propComments.length;
    
    let score = 0;
    if (count > 0) {
      const totalNetVotes = propComments.reduce((sum, c) => sum + (c.upvotes - c.downvotes), 0);
      const avgNetVotes = totalNetVotes / count;
      const avgQuality = Math.max(0.5, avgNetVotes + 1);
      
      const createdAtMillis = p.createdAt?.toMillis ? p.createdAt.toMillis() : Date.now();
      const timeActiveHours = Math.max(0.1, (Date.now() - createdAtMillis) / (1000 * 60 * 60));
      
      score = parseFloat(((count * avgQuality) / timeActiveHours).toFixed(2));
    }
    
    return {
      ...p,
      commentCount: count,
      deliberationScore: score
    };
  });
}, [proposals, comments]);
```

---

## 📈 Metric Properties & Behaviors

1. **Anti-Spam Scaling**:
   - Simply logging a massive volume of low-quality comments will not indefinitely boost the deliberation score. If spam comments are downvoted by the community, $\overline{V}_{\text{net}}$ becomes negative, pulling $Q_{\text{avg}}$ down to its floor threshold of $0.5$.
2. **Decay (Recency Effect)**:
   - Divide by $H_{\text{active}}$ ensures that old, stagnant threads naturally decline in rank, keeping the **Hot (Deliberation)** feed fresh.

---

## 🧭 Directory Connections
- 📊 **[Back to Analytics Index](../index.md)**
- 💬 **[View Comments Database Schema](../../database/tables/comments.md)**
- 🏠 **[Return to KB Master Index](../../index.md)**
