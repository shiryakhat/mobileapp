import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** All persisted stores are local-first and live in AsyncStorage under `syk.*` keys. */
export const jsonStorage = createJSONStorage(() => AsyncStorage, {
  // JSON.stringify throws on a BigInt (native modules hand Int64 over as one);
  // a store write must never throw into whoever called `set`.
  replacer: (_key, value) => (typeof value === 'bigint' ? Number(value) : value),
});
