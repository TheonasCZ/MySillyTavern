import { create } from "zustand";

import {
  createConnection,
  deleteConnection,
  listConnections,
  updateConnection,
} from "../db/repositories/connectionsRepo";
import type { ConnectionConfig, ConnectionDraft } from "../providers/types";

interface ConnectionsState {
  connections: ConnectionConfig[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: ConnectionDraft) => Promise<ConnectionConfig>;
  update: (id: string, draft: ConnectionDraft) => Promise<ConnectionConfig>;
  remove: (id: string) => Promise<void>;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  loaded: false,

  load: async () => {
    const connections = await listConnections();
    set({ connections, loaded: true });
  },

  add: async (draft) => {
    const created = await createConnection(draft);
    set({ connections: [...get().connections, created] });
    return created;
  },

  update: async (id, draft) => {
    const updated = await updateConnection(id, draft);
    set({
      connections: get().connections.map((c) => (c.id === id ? updated : c)),
    });
    return updated;
  },

  remove: async (id) => {
    await deleteConnection(id);
    set({ connections: get().connections.filter((c) => c.id !== id) });
  },
}));
