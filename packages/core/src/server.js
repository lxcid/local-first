// @flow
import * as hlc from '../../../packages/hybrid-logical-clock';
import {
    type Schema,
    validate,
    validateSet,
} from '../../../packages/nested-object-crdt/src/schema.js';

// OK folks, we're using sqlite for persistence. This is *synchronous*, which is lots of fun.
// And so we can I guess design an API that expects that.

/*

client -> server "here are some deltas"
server stores deltas
server stores data changes

ok so well the simplest way would be to not even store the changes, right?

And then, as an optimization, I could add in "we track the data too folks"

OK so simple mode:
client -> server "collection, no 'last delta seen'"
server gets all the deltas for that collection, and sends them
client -> server "some changes"
server puts those changes in the db
and then fetches them again ha ha

yeah what would the "simplest" backend look like, that just completely
relies on sqlite for all the things?


*/

export type ClientMessage<Delta, Data> = {
    type: 'sync',
    collection: string,
    serverCursor: ?CursorType,
    deltas: Array<{ node: string, delta: Delta }>,
};

export type ServerMessage<Delta, Data> =
    | {
          type: 'sync',
          collection: string,
          serverCursor: CursorType,
          deltas: Array<{ node: string, delta: Delta }>,
      }
    // Indicating that deltas from a client have been received.
    | { type: 'ack', collection: string, deltaStamp: string };

// This doesn't have any special permissions things
// We'll do collection-level permissions.

type CRDTImpl<Delta, Data> = {
    createEmpty: () => Data,
    applyDelta: (Data, Delta) => Data,
    deltas: {
        stamp: Delta => string,
    },
};

export type CursorType = number;

export type Persistence<Delta, Data> = {
    deltasSince(
        collection: string,
        lastSeen: ?CursorType,
        sessionId: string,
    ): ?{
        deltas: Array<{ node: string, delta: Delta }>,
        cursor: CursorType,
    },
    addDeltas(
        collection: string,
        sessionId: string,
        deltas: Array<{ node: string, delta: Delta }>,
    ): void,
    compact(
        collection: string,
        date: number,
        merge: (Delta, Delta) => Delta,
    ): void,
    // TODO maybe store nodes too though
    // This would be quite interesting really.
};

type Connection<Delta, Data> = {
    sessionId: string,
    send: (msg: ServerMessage<Delta, Data>) => void,
    on: (listener: (msg: ClientMessage<Delta, Data>) => void) => void,
};

export type ServerState<Delta, Data> = {
    persistence: Persistence<Delta, Data>,
    crdt: CRDTImpl<Delta, Data>,
    getSchema: string => Schema,
    clients: {
        [sessionId: string]: {
            collections: {
                [collectionId: string]: ?CursorType,
            },
        },
    },
};

export const getMessages = function<Delta, Data>(
    state: ServerState<Delta, Data>,
    sessionId: string,
): Array<ServerMessage<Delta, Data>> {
    if (!state.clients[sessionId]) {
        return [];
    }
    console.log(`Getting messages for ${sessionId}`);
    return Object.keys(state.clients[sessionId].collections)
        .map((cid: string): ?ServerMessage<Delta, Data> => {
            const lastSeen = state.clients[sessionId].collections[cid];
            const result = state.persistence.deltasSince(
                cid,
                lastSeen,
                sessionId,
            );
            if (!result) {
                console.log('no new messages since', lastSeen);
                return;
            }
            const { cursor, deltas } = result;
            // console.log('getting all since', lastSeen, cursor, deltas);
            console.log(
                deltas.length,
                'new messages since',
                lastSeen,
                'new cursor',
                cursor,
            );
            if (deltas.length) {
                if (!cursor) {
                    throw new Error(`Got deltas, but no cursor`);
                }
                return {
                    type: 'sync',
                    collection: cid,
                    deltas,
                    serverCursor: cursor,
                };
            }
        })
        .filter(Boolean);
};

export const onMessage = function<Delta, Data>(
    state: ServerState<Delta, Data>,
    sessionId: string,
    message: ClientMessage<Delta, Data>,
): ?ServerMessage<Delta, Data> {
    if (message.type === 'sync') {
        if (!state.clients[sessionId]) {
            state.clients[sessionId] = { collections: {} };
        }
        const schema = state.getSchema(message.collection);
        console.log('Setting server cursor', message);
        // TODO should I only set this if its present?
        state.clients[sessionId].collections[message.collection] =
            message.serverCursor;
        if (message.deltas.length) {
            // const deltas = message.deltas.map(item => ({ ...item, sessionId }));
            state.persistence.addDeltas(
                message.collection,
                sessionId,
                message.deltas,
            );
            let maxStamp = null;
            message.deltas.forEach(delta => {
                const stamp = state.crdt.deltas.stamp(delta.delta);
                if (!maxStamp || stamp > maxStamp) {
                    maxStamp = stamp;
                }
            });
            console.log('max', maxStamp, message.deltas);
            if (maxStamp) {
                console.log('acking');
                return {
                    type: 'ack',
                    deltaStamp: maxStamp,
                    collection: message.collection,
                };
            }
            console.log('not acking');
        }
    }
};

const make = <Delta, Data>(
    crdt: CRDTImpl<Delta, Data>,
    persistence: Persistence<Delta, Data>,
    getSchema: string => Schema,
): ServerState<Delta, Data> => {
    return { crdt, persistence, getSchema, clients: {} };
};

export default make;
