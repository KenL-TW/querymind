# QueryMind Production Release Evidence Checklist

Record the following in the release manifest/report, not in conversational history:

- Release ID, Git SHA, tag, operator, and timestamp
- Worker ID and previous/rollback Worker ID
- APP/DATA migration level and schema snapshot
- Policy version/count and semantic registry version
- AI model configuration fingerprint and prompt version/fingerprint
- Unit/E2E/full counts, health result, anonymous auth result, authenticated smoke result
- Manual mutation gate status, known issues, and rollback plan

Before release, run `npm run release:preflight`, `npm run deploy:dry-run`, all regression gates, and `npm run smoke:production` after deployment. D1 migration is a separate explicitly authorized operation.
