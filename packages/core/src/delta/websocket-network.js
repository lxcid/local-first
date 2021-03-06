// @flow
import { type PeerChange } from '../types';
import { type ClientMessage, type ServerMessage } from '../server';
import type { Network, NetworkCreator } from '../types.js';
import backOff from '../back-off';
import { peerTabAwareSync } from '../peer-tabs';

const reconnectingSocket = (
    url,
    onOpen,
    onMessage: string => mixed,
    updateStatus: SyncStatus => mixed,
) => {
    const state: { socket: ?WebSocket } = {
        socket: null,
    };
    const reconnect = () => {
        state.socket = null;
        updateStatus({ status: 'disconnected' });
        backOff(
            () =>
                new Promise((res, rej) => {
                    const socket = new WebSocket(url);
                    let opened = false;
                    socket.addEventListener('open', () => {
                        state.socket = socket;
                        opened = true;
                        res(true);
                        updateStatus({ status: 'connected' });
                        onOpen();
                    });
                    socket.addEventListener('close', () => {
                        if (opened) {
                            reconnect();
                        } else {
                            res(false);
                        }
                    });
                    socket.addEventListener(
                        'message',
                        ({ data }: { data: any }) => onMessage(data),
                    );
                }),
            500,
            1.5,
        );
    };
    reconnect();
    return state;
};

type SyncStatus = { status: 'connected' } | { status: 'disconnected' };

const createWebSocketNetwork = <Delta, Data>(
    url: string,
): NetworkCreator<Delta, Data, SyncStatus> => (
    sessionId: string,
    getMessages,
    handleMessages,
): Network<SyncStatus> => {
    return {
        initial: { status: 'disconnected' },
        createSync: (sendCrossTabChange, updateStatus, softResync) => {
            console.log('Im the leader (websocket)');
            const state = reconnectingSocket(
                `${url}?sessionId=${sessionId}`,
                () => sync(false),
                async msg => {
                    const messages = JSON.parse(msg);
                    const changed = await handleMessages(
                        messages,
                        sendCrossTabChange,
                    ).catch(err => {
                        console.log('Failed to handle messages!');
                        console.error(err);
                    });
                    if (changed) {
                        softResync();
                    }
                },
                updateStatus,
            );

            const sync = (softSync: boolean) => {
                if (state.socket) {
                    const socket = state.socket;
                    getMessages(!softSync).then(
                        messages => {
                            if (messages.length) {
                                socket.send(JSON.stringify(messages));
                            } else {
                                console.log('nothing to sync here');
                            }
                        },
                        err => {
                            console.error('Failed to sync messages folks');
                            console.error(err);
                        },
                    );
                } else {
                    console.log('but no socket');
                }
            };
            return sync;
        },
    };
};

export default createWebSocketNetwork;
