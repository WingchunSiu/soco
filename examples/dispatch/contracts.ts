export type Event = { kind: string; id: string };
export type Request = { id: string; user: string; body: string };
export type Reply = { status: number; body: unknown };
// Resolves only after the event is on durable storage; rejects on failure.
export declare function appendCommitted(event: Event): Promise<void>;
// Returns only after the event is on durable storage; throws on failure.
export declare function appendCommittedSync(event: Event): void;
// Commits all events atomically to durable storage before resolving.
export declare function commitOutbox(events: Event[]): Promise<void>;
export declare function updateEntity(id: string, body: string): Promise<void>;
export declare function charge(id: string): Promise<void>;
export declare function render(id: string): Promise<string>;
export declare function query(term: string): Promise<string[]>;
// send immediately makes the response observable; later awaits cannot retract it.
export type Response = { send(reply: Reply): void };
