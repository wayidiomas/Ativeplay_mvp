/**
 * Watch History Store
 *
 * Manages "Continue Watching" functionality with:
 * - Local cache for immediate access
 * - Background sync with server for persistence across devices/sessions
 * - Tied to device_id, not playlist (persists across playlist changes)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  syncWatchHistory,
  getWatchHistory,
  deleteWatchHistoryItem,
  type WatchHistoryItem,
} from '@core/services/api';

// ============================================================================
// Types
// ============================================================================

interface WatchHistoryState {
  // Local items cache
  items: WatchHistoryItem[];

  // Sync state
  isSyncing: boolean;
  lastSyncAt: number | null;
  pendingSync: WatchHistoryItem[]; // Items waiting to be synced

  // Actions
  addItem: (item: Omit<WatchHistoryItem, 'watchedAt'>) => void;
  updatePosition: (itemHash: string, positionMs: number, durationMs?: number) => void;
  removeItem: (itemHash: string) => void;
  getItem: (itemHash: string) => WatchHistoryItem | undefined;
  getContinueWatching: (limit?: number) => WatchHistoryItem[];

  // Sync actions
  syncToServer: () => Promise<void>;
  loadFromServer: () => Promise<void>;
  clearAll: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_ITEMS = 100; // Keep last 100 items locally
const SYNC_DEBOUNCE_MS = 30000; // Sync every 30 seconds
const MIN_PROGRESS_PERCENT = 5; // Don't show items with < 5% progress
const MAX_PROGRESS_PERCENT = 95; // Consider completed if > 95%

// ============================================================================
// Store
// ============================================================================

export const useWatchHistoryStore = create<WatchHistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      isSyncing: false,
      lastSyncAt: null,
      pendingSync: [],

      /**
       * Add or update a watch history item
       */
      addItem: (item) => {
        const watchedAt = Date.now();
        const newItem: WatchHistoryItem = { ...item, watchedAt };

        set((state) => {
          // Remove existing item with same hash if exists
          const filtered = state.items.filter((i) => i.itemHash !== item.itemHash);

          // Add new item at the beginning (most recent first)
          const items = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);

          // Add to pending sync
          const pendingSync = [
            ...state.pendingSync.filter((i) => i.itemHash !== item.itemHash),
            newItem,
          ];

          return { items, pendingSync };
        });
      },

      /**
       * Update playback position for an existing item
       */
      updatePosition: (itemHash, positionMs, durationMs) => {
        const watchedAt = Date.now();

        set((state) => {
          const itemIndex = state.items.findIndex((i) => i.itemHash === itemHash);
          if (itemIndex === -1) return state;

          const existingItem = state.items[itemIndex];
          const updatedItem: WatchHistoryItem = {
            ...existingItem,
            positionMs,
            durationMs: durationMs ?? existingItem.durationMs,
            watchedAt,
          };

          // Move to front (most recent)
          const items = [
            updatedItem,
            ...state.items.filter((i) => i.itemHash !== itemHash),
          ].slice(0, MAX_HISTORY_ITEMS);

          // Add to pending sync
          const pendingSync = [
            ...state.pendingSync.filter((i) => i.itemHash !== itemHash),
            updatedItem,
          ];

          return { items, pendingSync };
        });
      },

      /**
       * Remove a specific item from history
       */
      removeItem: (itemHash) => {
        set((state) => ({
          items: state.items.filter((i) => i.itemHash !== itemHash),
          pendingSync: state.pendingSync.filter((i) => i.itemHash !== itemHash),
        }));

        // Also remove from server
        deleteWatchHistoryItem(itemHash).catch((e) =>
          console.warn('[WatchHistory] Failed to delete from server:', e)
        );
      },

      /**
       * Get a specific item by hash
       */
      getItem: (itemHash) => {
        return get().items.find((i) => i.itemHash === itemHash);
      },

      /**
       * Get items for "Continue Watching" section
       * Filters out completed and barely-started items
       */
      getContinueWatching: (limit = 10) => {
        return get()
          .items.filter((item) => {
            if (!item.durationMs || item.durationMs <= 0) return true; // Include if duration unknown

            const progressPercent = (item.positionMs / item.durationMs) * 100;

            // Filter out:
            // - Items that haven't really started (< 5%)
            // - Items that are basically complete (> 95%)
            return progressPercent >= MIN_PROGRESS_PERCENT && progressPercent < MAX_PROGRESS_PERCENT;
          })
          .slice(0, limit);
      },

      /**
       * Sync pending items to server
       */
      syncToServer: async () => {
        const state = get();
        if (state.isSyncing || state.pendingSync.length === 0) return;

        set({ isSyncing: true });

        try {
          const itemsToSync = [...state.pendingSync];
          const result = await syncWatchHistory(itemsToSync);

          if (result.success) {
            set({
              pendingSync: [],
              lastSyncAt: Date.now(),
            });
            console.log(`[WatchHistory] Synced ${result.synced} items to server`);
          }
        } catch (error) {
          console.warn('[WatchHistory] Sync failed:', error);
          // Keep items in pendingSync for retry
        } finally {
          set({ isSyncing: false });
        }
      },

      /**
       * Load history from server and merge with local
       */
      loadFromServer: async () => {
        try {
          const response = await getWatchHistory(MAX_HISTORY_ITEMS);

          set((state) => {
            // Merge server items with local items
            // Local items take precedence (more recent)
            const localHashes = new Set(state.items.map((i) => i.itemHash));
            const serverItems = response.items.filter((i) => !localHashes.has(i.itemHash));

            // Combine and sort by watchedAt
            const items = [...state.items, ...serverItems]
              .sort((a, b) => b.watchedAt - a.watchedAt)
              .slice(0, MAX_HISTORY_ITEMS);

            return { items, lastSyncAt: Date.now() };
          });

          console.log(`[WatchHistory] Loaded ${response.total} items from server`);
        } catch (error) {
          console.warn('[WatchHistory] Failed to load from server:', error);
        }
      },

      /**
       * Clear all watch history
       */
      clearAll: () => {
        set({
          items: [],
          pendingSync: [],
          lastSyncAt: null,
        });
      },
    }),
    {
      name: 'ativeplay-watch-history',
      storage: createJSONStorage(() => localStorage),
      // Persist items and lastSyncAt
      partialize: (state) => ({
        items: state.items,
        lastSyncAt: state.lastSyncAt,
      }),
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectItems = (state: WatchHistoryState) => state.items;
export const selectIsSyncing = (state: WatchHistoryState) => state.isSyncing;
export const selectHasItems = (state: WatchHistoryState) => state.items.length > 0;
export const selectContinueWatching = (state: WatchHistoryState) =>
  state.getContinueWatching();

// ============================================================================
// Auto-sync timer
// ============================================================================

let syncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start auto-sync timer (call on app startup)
 */
export function startWatchHistorySyncTimer(): void {
  if (syncTimer) return;

  // Load from server on startup
  useWatchHistoryStore.getState().loadFromServer();

  // Start periodic sync
  syncTimer = setInterval(() => {
    useWatchHistoryStore.getState().syncToServer();
  }, SYNC_DEBOUNCE_MS);

  console.log('[WatchHistory] Auto-sync timer started');
}

/**
 * Stop auto-sync timer (call on app shutdown)
 */
export function stopWatchHistorySyncTimer(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;

    // Final sync on shutdown
    useWatchHistoryStore.getState().syncToServer();
    console.log('[WatchHistory] Auto-sync timer stopped');
  }
}

export default useWatchHistoryStore;
