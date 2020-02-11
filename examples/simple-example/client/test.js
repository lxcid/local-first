// @flow
import * as hlc from '@local-first/hybrid-logical-clock';
import type { HLC } from '@local-first/hybrid-logical-clock';
import * as crdt from '@local-first/nested-object-crdt';
import type { Delta, CRDT as Data } from '@local-first/nested-object-crdt';
import { ItemSchema } from '../shared/schema.js';

import createClient from '../fault-tolerant/delta/create-client';
import makeDeltaPersistence from '../fault-tolerant/delta/idb-persistence';
import createPollingNetwork from '../fault-tolerant/delta/polling-network';
import createWebSocketNetwork from '../fault-tolerant/delta/websocket-network';

import createBlobClient from '../fault-tolerant/blob/create-client';
import makeBlobPersistence from '../fault-tolerant/blob/idb-persistence';
import createBasicBlobNetwork from '../fault-tolerant/blob/basic-network';

import createMultiClient from '../fault-tolerant/multi/create-client';
import makeMultiPersistence from '../fault-tolerant/multi/idb-persistence';

const clockPersist = (key: string) => ({
    get(init) {
        const raw = localStorage.getItem(key);
        if (!raw) {
            const res = init();
            localStorage.setItem(key, hlc.pack(res));
            return res;
        }
        return hlc.unpack(raw);
    },
    set(clock: HLC) {
        localStorage.setItem(key, hlc.pack(clock));
    },
});

window.setupLocalCache = async collection => {
    window.collection = window.client.getCollection(collection);
    window.data = await window.collection.loadAll();
    window.collection.onChanges(changes => {
        changes.forEach(({ value, id }) => {
            if (value) {
                window.data[id] = value;
            } else {
                delete window.data[id];
            }
        });
    });
};

window.clearData = async () => {
    Object.keys(localStorage).forEach(key => {
        localStorage.removeItem(key);
    });
    const r = await window.indexedDB.databases();
    for (var i = 0; i < r.length; i++) {
        window.indexedDB.deleteDatabase(r[i].name);
    }
};

window.ItemSchema = ItemSchema;

window.setupMulti = (deltaNetwork, blobConfigs) => {
    const deltas = {};
    const blobs = {};
    Object.keys(blobConfigs).forEach(key => {
        blobs[key] = createBasicBlobNetwork(blobConfigs[key]);
    });
    const client = createMultiClient(
        crdt,
        { tasks: ItemSchema },
        clockPersist('multi'),
        makeMultiPersistence(
            'multi-first-second',
            ['tasks'],
            deltaNetwork ? true : false,
            Object.keys(blobs),
        ),
        deltaNetwork
            ? deltaNetwork.type === 'ws'
                ? createWebSocketNetwork(deltaNetwork.url)
                : createPollingNetwork(deltaNetwork.url)
            : null,
        blobs,
    );
    window.client = client;
};

window.setupPolling = port =>
    setup(createPollingNetwork(`http://localhost:${port}/sync`));
window.setupWebSockets = port =>
    setup(createWebSocketNetwork(`ws://localhost:${port}/sync`));
window.setupBlob = port => {
    const client = createBlobClient(
        crdt,
        { tasks: ItemSchema },
        clockPersist('local-first'),
        makeBlobPersistence('local-first', ['tasks']),
        // etag: ?string => Promise<?Blob<Data>>
        // Blob<data> => Promise<string>
        createBasicBlobNetwork(`http://localhost:${port}/blob/stuff`),
        // createPollingNetwork('http://localhost:9900/sync'),
        // createWebSocketNetwork('ws://localhost:9900/sync'),
    );
    console.log('set up blob');
    window.client = client;
};

const setup = makeNetwork => {
    const client = createClient(
        crdt,
        { tasks: ItemSchema },
        clockPersist('test'),
        makeDeltaPersistence('test', ['tasks']),
        makeNetwork,
    );
    console.log('setting up');
    window.client = client;
    console.log('Ok set up');
};
