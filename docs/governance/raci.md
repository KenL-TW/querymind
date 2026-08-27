# QueryMind Engineering and Governance RACI

| Activity | Accountable | Responsible | Consulted |
|---|---|---|---|
| Policy change | Security Owner | Release Owner | DBA / Data Owner |
| Schema refresh | DBA / Schema Steward | Application Engineer | Security Owner |
| Semantic Draft | Data Owner / delegated manager | Application Engineer | DBA |
| Semantic approval (future P2-E) | Explicit future authority | Not implemented | Security Owner |
| Production release | Release Owner | Application Engineer | Security Owner |
| Security incident | Security Owner | Platform / Application Engineer | Release Owner |
| D1 recovery decision | Release Owner | DBA / Schema Steward | Security Owner |

P2-D does not create semantic approval authority. AI may propose design-time suggestions but cannot approve or activate semantic truth.
