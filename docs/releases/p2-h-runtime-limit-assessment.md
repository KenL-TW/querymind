# QueryMind P2-H — Runtime Limit Assessment

QueryMind intentionally uses a bounded tokenizer plus deterministic catalog,
scope, row-policy rewrite, DLP, and response budgets. It is not a general
SQLite parser. Comments, semicolons, writes, recursive CTEs, comma source
lists, CROSS/NATURAL JOIN, ambiguous lineage, and amplification functions are
denied. Unsupported SQL syntax requires a dedicated parser/P0 security review.

D1 provides prepared statements and APP metadata batches. QueryMind does not
assume arbitrary-query cancellation or a global semantic activation lock. It
enforces application SQL/row/byte/rate limits and AI timeout. A confirmed
authorization bypass, unprovable lineage, or cancellation requirement is a
release stop and architecture escalation trigger.
