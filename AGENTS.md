# Working on SOCO

- This is a TypeScript research prototype. Use Node 22+; `npm test` builds and tests.
- Read README.md for the actual scope. Do not describe a scripted mock as model evidence.
- Never print or commit `.env`, authentication headers, or credentials. Load the project-local `.env` only.
- Source and traces can contain private code. Do not upload them or push a repository without user authorization.
- Preserve ordinary search/read paths alongside Jev so missed evidence can be recovered.
- Keep source references versioned; never silently use old line ranges after edits.
- Log unknown usage and uncertain scores explicitly. Do not infer zero cost or completeness.
- Code execution currently uses a local child process, not a security sandbox. Do not claim otherwise.
- Keep root-provider integration behind `RootModel`; avoid coupling corpus/Jev logic to Pi.
- No real API calls until the user has supplied credentials for testing. Once supplied for that purpose, bounded smoke tests are authorized; start small and record actual outcomes.
