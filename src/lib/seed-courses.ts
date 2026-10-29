import type { Course } from "./course-types";

const encouraging = {
  depth: "balanced",
  tone: "encouraging",
  pacing: "balanced",
  enforceQuizzes: true,
} as const;

export const seedCourses: Course[] = [
  {
    id: "distributed-systems",
    title: "Distributed Systems & Microservices",
    tagline: "Build systems that stay correct when machines disagree.",
    description:
      "A practical tour of service boundaries, asynchronous messaging, consensus, and the caching trade-offs that decide whether a distributed system feels fast or feels broken.",
    difficulty: "advanced",
    status: "published",
    tags: ["Architecture", "Backend", "Systems"],
    teaching: { ...encouraging },
    modules: [
      {
        id: "ds-m1",
        title: "Architecture & Message Queues",
        summary:
          "Service boundaries, synchronous vs asynchronous communication, and queue delivery semantics.",
        lessons: [
          {
            id: "ds-m1-l1",
            title: "Service Boundaries That Survive Change",
            minutes: 18,
            intuition:
              "A good service boundary is a **line drawn around data that changes together**. If two features always change in the same deploy, they probably belong in the same service. Boundaries are about coupling, not about code size.",
            objectives: [
              "Explain coupling and cohesion in service design",
              "Choose between a shared database and service-owned data",
              "Spot a distributed monolith before it ships",
            ],
            concepts: [
              "Bounded context",
              "Data ownership",
              "Chatty vs coarse APIs",
              "Distributed monolith",
            ],
            codeExamples: [
              {
                label: "A coarse-grained API that avoids chatty calls",
                language: "typescript",
                code: `// Bad: three round trips per order render
const order = await orders.get(id);
const user = await users.get(order.userId);
const items = await catalog.getMany(order.itemIds);

// Better: one boundary-aware read model
const view = await orders.getOrderView(id);
// { order, customerName, items: [{ id, title, price }] }`,
              },
            ],
            diagram: {
              title: "Two services, one owner per table",
              mermaid: `flowchart LR
  C[Client] --> G[API Gateway]
  G --> O[Order Service]
  G --> Cat[Catalog Service]
  O --> ODB[(orders db)]
  Cat --> CDB[(catalog db)]
  O -. read model .-> Cat`,
            },
            quiz: [
              {
                id: "ds-m1-l1-q1",
                kind: "multiple-choice",
                prompt:
                  "Two services must always be deployed together or requests fail. What smell is this?",
                options: [
                  "Healthy cohesion",
                  "A distributed monolith",
                  "Eventual consistency",
                  "Backpressure",
                ],
                answerIndex: 1,
                explanation:
                  "Lock-step deploys mean the boundary is wrong: you pay network cost while keeping monolith coupling.",
              },
            ],
          },
          {
            id: "ds-m1-l2",
            title: "Message Queues & Delivery Semantics",
            minutes: 22,
            intuition:
              "A queue turns a *call* into a *promise*. You trade an immediate answer for durability and buffering. The hard part is not sending — it is what happens when the same message arrives twice.",
            objectives: [
              "Compare at-most-once, at-least-once, and exactly-once delivery",
              "Make a consumer idempotent",
              "Use dead-letter queues and retries deliberately",
            ],
            concepts: ["Idempotency key", "At-least-once delivery", "Dead-letter queue", "Backpressure"],
            codeExamples: [
              {
                label: "Idempotent consumer",
                language: "python",
                code: `def handle(msg):
    # dedupe on a business key, not the broker message id
    if seen.add_if_absent(msg["payment_id"]):
        charge(msg)
    else:
        log.info("duplicate ignored", msg["payment_id"])`,
              },
            ],
            diagram: {
              title: "Producer, queue, consumer, DLQ",
              mermaid: `sequenceDiagram
  participant P as Producer
  participant Q as Queue
  participant C as Consumer
  participant D as DLQ
  P->>Q: publish(payment)
  Q->>C: deliver(payment)
  C--xQ: nack (transient error)
  Q->>C: redeliver(payment)
  C->>Q: ack
  Q->>D: after N failures`,
            },
            quiz: [
              {
                id: "ds-m1-l2-q1",
                kind: "multiple-choice",
                prompt: "With at-least-once delivery, what must the consumer guarantee?",
                options: [
                  "Ordering across partitions",
                  "Idempotent processing",
                  "Exactly-once publishing",
                  "Synchronous acknowledgement",
                ],
                answerIndex: 1,
                explanation:
                  "Duplicates are expected, so processing the same message twice must have the same effect as once.",
              },
            ],
          },
        ],
      },
      {
        id: "ds-m2",
        title: "Consensus & Raft",
        summary: "Leader election, log replication, and why quorums beat majorities of opinion.",
        lessons: [
          {
            id: "ds-m2-l1",
            title: "Raft: Leaders, Terms, and Logs",
            minutes: 25,
            intuition:
              "Raft's trick is to make one node the **single writer** for a while (a term), then replicate its log. Agreement becomes 'do most nodes have this entry?' instead of 'do all nodes agree on everything?'",
            objectives: [
              "Describe leader election and terms",
              "Explain why a quorum is N/2 + 1",
              "Trace how an entry becomes committed",
            ],
            concepts: ["Term", "Quorum", "Log replication", "Split brain", "Commit index"],
            codeExamples: [
              {
                label: "Quorum math",
                language: "python",
                code: `def quorum(n: int) -> int:
    return n // 2 + 1

quorum(3)  # 2  -> tolerates 1 failure
quorum(5)  # 3  -> tolerates 2 failures`,
              },
            ],
            diagram: {
              title: "Election then replication",
              mermaid: `sequenceDiagram
  participant F1 as Follower 1
  participant Cand as Candidate
  participant F2 as Follower 2
  Cand->>F1: RequestVote(term=4)
  Cand->>F2: RequestVote(term=4)
  F1-->>Cand: voteGranted
  F2-->>Cand: voteGranted
  Note over Cand: elected leader (term 4)
  Cand->>F1: AppendEntries([x=1])
  Cand->>F2: AppendEntries([x=1])
  F1-->>Cand: ok
  Note over Cand: quorum reached -> committed`,
            },
            quiz: [
              {
                id: "ds-m2-l1-q1",
                kind: "code-prediction",
                prompt: "What does this print for a 5-node cluster?",
                code: `n = 5
print(n // 2 + 1)`,
                language: "python",
                options: ["2", "3", "4", "5"],
                answerIndex: 1,
                explanation: "5 // 2 = 2, plus 1 = 3. A 5-node cluster commits with 3 nodes.",
              },
            ],
          },
        ],
      },
      {
        id: "ds-m3",
        title: "Caching & Data Consistency",
        summary: "Cache strategies, invalidation, and choosing your consistency window on purpose.",
        lessons: [
          {
            id: "ds-m3-l1",
            title: "Cache Strategies and Stale Reads",
            minutes: 20,
            intuition:
              "Every cache is a bet that **reading old data is cheaper than being slow**. Your job is to size that bet: how stale, for how long, and who notices.",
            objectives: [
              "Compare cache-aside, write-through, and write-behind",
              "Reason about TTLs and stampedes",
              "Pick a consistency model per read path",
            ],
            concepts: ["Cache-aside", "Write-through", "TTL", "Cache stampede", "Eventual consistency"],
            codeExamples: [
              {
                label: "Cache-aside with jittered TTL",
                language: "typescript",
                code: `async function getProduct(id: string) {
  const hit = await cache.get(id);
  if (hit) return hit;
  const row = await db.products.find(id);
  const ttl = 300 + Math.floor(Math.random() * 60); // jitter avoids stampedes
  await cache.set(id, row, ttl);
  return row;
}`,
              },
            ],
            diagram: {
              title: "Cache-aside read path",
              mermaid: `flowchart TD
  A[Request] --> B{In cache?}
  B -- yes --> C[Return cached]
  B -- no --> D[Read database]
  D --> E[Write cache with TTL + jitter]
  E --> C`,
            },
            quiz: [
              {
                id: "ds-m3-l1-q1",
                kind: "multiple-choice",
                prompt: "Thousands of requests miss the cache at the same instant. This is a…",
                options: ["Split brain", "Cache stampede", "Write-behind", "Quorum loss"],
                answerIndex: 1,
                explanation:
                  "Synchronised expiry sends the whole herd to the database. Jitter TTLs or use a single-flight lock.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "python-algorithms",
    title: "Python & Algorithmic Problem Solving",
    tagline: "Turn messy problems into clean, provably fast Python.",
    description:
      "Build the reflexes interviewers and production code both reward: complexity intuition, recursion with memoisation, array and string patterns, and graph traversal.",
    difficulty: "intermediate",
    status: "published",
    tags: ["Python", "Algorithms", "Interview prep"],
    teaching: { ...encouraging },
    modules: [
      {
        id: "py-m1",
        title: "Complexity Intuition",
        summary: "Reading growth rates off code without counting every operation.",
        lessons: [
          {
            id: "py-m1-l1",
            title: "Big-O You Can Eyeball",
            minutes: 15,
            intuition:
              "Complexity is about **how work grows**, not how long it takes today. Look for loops over the input, then ask what each iteration costs.",
            objectives: [
              "Derive Big-O from nested loops",
              "Recognise hidden costs of built-ins like `in` on a list",
              "Trade memory for time using a set or dict",
            ],
            concepts: ["Big-O", "Amortised cost", "Hash lookup", "Space-time trade-off"],
            codeExamples: [
              {
                label: "O(n^2) to O(n) with a set",
                language: "python",
                code: `def has_pair(nums, target):
    seen = set()
    for n in nums:
        if target - n in seen:   # O(1) average
            return True
        seen.add(n)
    return False`,
              },
            ],
            diagram: {
              title: "Choosing a data structure",
              mermaid: `flowchart TD
  A[Need membership checks?] -- yes --> B[set / dict: O(1)]
  A -- no --> C[Need order?]
  C -- yes --> D[list]
  C -- no --> E[generator / stream]`,
            },
            quiz: [
              {
                id: "py-m1-l1-q1",
                kind: "code-prediction",
                prompt: "What is the average time complexity of has_pair above?",
                code: `has_pair([2, 7, 11, 15], 9)`,
                language: "python",
                options: ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
                answerIndex: 2,
                explanation: "One pass over n items with O(1) average set operations gives O(n).",
              },
            ],
          },
        ],
      },
      {
        id: "py-m2",
        title: "Recursion & Memoisation",
        summary: "Describing a problem in terms of itself, then paying for each subproblem once.",
        lessons: [
          {
            id: "py-m2-l1",
            title: "From Recursion to Dynamic Programming",
            minutes: 22,
            intuition:
              "Recursion writes the *definition*; memoisation makes it *affordable*. If your recursive calls repeat, cache them and the exponential collapses to linear.",
            objectives: [
              "Write a recurrence and its base case",
              "Add memoisation with functools.lru_cache",
              "Convert top-down memoisation into bottom-up DP",
            ],
            concepts: ["Recurrence", "Base case", "Overlapping subproblems", "lru_cache", "Bottom-up DP"],
            codeExamples: [
              {
                label: "Memoised Fibonacci",
                language: "python",
                code: `from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(50))  # instant instead of forever`,
              },
            ],
            diagram: {
              title: "Overlapping subproblems",
              mermaid: `flowchart TD
  F5[fib 5] --> F4[fib 4]
  F5 --> F3[fib 3]
  F4 --> F3
  F4 --> F2[fib 2]
  F3 --> F2
  F3 --> F1[fib 1]`,
            },
            quiz: [
              {
                id: "py-m2-l1-q1",
                kind: "multiple-choice",
                prompt: "Memoisation helps most when the recursion has…",
                options: [
                  "Deep but distinct subproblems",
                  "Overlapping subproblems",
                  "No base case",
                  "Tail calls only",
                ],
                answerIndex: 1,
                explanation: "Caching pays off only when the same subproblem is requested again.",
              },
            ],
          },
        ],
      },
      {
        id: "py-m3",
        title: "Array, String & Graph Patterns",
        summary: "The handful of patterns that solve most problems: two pointers, sliding window, BFS/DFS.",
        lessons: [
          {
            id: "py-m3-l1",
            title: "Two Pointers & Sliding Window",
            minutes: 20,
            intuition:
              "When a brute force checks every pair, ask whether moving one index forward can ever require moving the other backward. If not, two pointers work.",
            objectives: [
              "Apply two pointers on sorted input",
              "Maintain a sliding window invariant",
              "Prove the window never shrinks incorrectly",
            ],
            concepts: ["Two pointers", "Sliding window", "Invariant", "Monotonicity"],
            codeExamples: [
              {
                label: "Longest substring without repeats",
                language: "python",
                code: `def longest_unique(s: str) -> int:
    last = {}
    start = best = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best`,
              },
            ],
            diagram: {
              title: "Window movement",
              mermaid: `flowchart LR
  S[start] -->|jump past duplicate| S2[start']
  I[i moves right one step] --> B[best = max window]`,
            },
            quiz: [
              {
                id: "py-m3-l1-q1",
                kind: "code-prediction",
                prompt: "What does longest_unique('abcabcbb') return?",
                code: `longest_unique("abcabcbb")`,
                language: "python",
                options: ["2", "3", "4", "8"],
                answerIndex: 1,
                explanation: "'abc' is the longest window with no repeated character, so the answer is 3.",
              },
            ],
          },
          {
            id: "py-m3-l2",
            title: "Graph Traversal: BFS and DFS",
            minutes: 24,
            intuition:
              "BFS explores by **distance**, DFS explores by **commitment**. Shortest path on unweighted edges is always BFS; reachability, cycles, and ordering usually want DFS.",
            objectives: [
              "Implement BFS with a deque",
              "Implement DFS recursively and iteratively",
              "Choose the right traversal for a question",
            ],
            concepts: ["Adjacency list", "BFS queue", "DFS stack", "Visited set", "Shortest path"],
            codeExamples: [
              {
                label: "BFS shortest hops",
                language: "python",
                code: `from collections import deque

def hops(graph, src, dst):
    q = deque([(src, 0)])
    seen = {src}
    while q:
        node, d = q.popleft()
        if node == dst:
            return d
        for nxt in graph[node]:
            if nxt not in seen:
                seen.add(nxt)
                q.append((nxt, d + 1))
    return -1`,
              },
            ],
            diagram: {
              title: "BFS layers",
              mermaid: `flowchart TD
  A((A)) --> B((B))
  A --> C((C))
  B --> D((D))
  C --> D
  D --> E((E))`,
            },
            quiz: [
              {
                id: "py-m3-l2-q1",
                kind: "multiple-choice",
                prompt: "Shortest path in an unweighted graph is found by…",
                options: ["DFS", "BFS", "Dijkstra only", "Topological sort"],
                answerIndex: 1,
                explanation: "BFS visits nodes in order of hop distance, so the first arrival is shortest.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "sql-foundations",
    title: "SQL for Product Engineers",
    tagline: "Query design, indexes, and reading a query plan.",
    description:
      "A draft course outline covering joins, window functions, and index strategy. Still being authored in the studio.",
    difficulty: "beginner",
    status: "draft",
    tags: ["SQL", "Data"],
    teaching: { depth: "overview", tone: "encouraging", pacing: "balanced", enforceQuizzes: false },
    modules: [
      {
        id: "sql-m1",
        title: "Joins & Aggregations",
        summary: "Relational thinking, join types, and grouping.",
        lessons: [
          {
            id: "sql-m1-l1",
            title: "Thinking in Sets",
            minutes: 12,
            intuition: "A join is a filtered cross product. Start from the rows you want to keep.",
            objectives: ["Distinguish inner and outer joins", "Group and aggregate correctly"],
            concepts: ["Inner join", "Left join", "GROUP BY"],
            codeExamples: [
              {
                label: "Orders per customer",
                language: "sql",
                code: `select c.name, count(o.id) as orders
from customers c
left join orders o on o.customer_id = c.id
group by c.name
order by orders desc;`,
              },
            ],
            quiz: [
              {
                id: "sql-m1-l1-q1",
                kind: "multiple-choice",
                prompt: "Which join keeps customers with zero orders?",
                options: ["inner join", "left join", "cross join", "semi join"],
                answerIndex: 1,
                explanation: "A left join preserves every row from the left table.",
              },
            ],
          },
        ],
      },
    ],
  },
];
