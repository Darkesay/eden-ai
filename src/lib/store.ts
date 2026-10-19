import { createStore } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import { useEffect, useState } from 'react';

export const store = createStore();

export const persister = createIndexedDbPersister(store, 'botanix-db');

export async function initStore() {
  await persister.startAutoLoad();
  await persister.startAutoSave();
}

// Custom hooks to bind to TinyBase
export function useStoreValue<T = any>(key: string, defaultValue: T): T {
  const [val, setVal] = useState<T>(
    (store.getValue(key) as unknown as T) ?? defaultValue
  );

  useEffect(() => {
    const listenerId = store.addValueListener(key, () => {
      setVal((store.getValue(key) as unknown as T) ?? defaultValue);
    });
    return () => { store.delListener(listenerId); };
  }, [key, defaultValue]);

  return val;
}

export function useStoreTable(tableId: string) {
  const [table, setTable] = useState(() => store.getTable(tableId));

  useEffect(() => {
    const listenerId = store.addTableListener(tableId, () => {
      setTable(store.getTable(tableId));
    });
    return () => { store.delListener(listenerId); };
  }, [tableId]);

  return table;
}

