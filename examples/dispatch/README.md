# Dispatch service

This is an authored, read-only investigation fixture. No infrastructure runs here.
Each exported function under handlers/ is an independent HTTP handler.
Handlers return response objects, except files.ts, which uses a response sender.
Audit helper implementations live under services/.
The external storage and response primitives are specified in contracts.ts.
A process may terminate at any instruction; in-memory work and timers are lost.
A successful HTTP response is observable when a handler returns it or calls response.send().
Only a durable audit record (including an audit record in a committed outbox) satisfies the audit requirement.
