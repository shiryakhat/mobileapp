import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** All persisted stores are local-first and live in AsyncStorage under `syk.*` keys. */
export const jsonStorage = createJSONStorage(() => AsyncStorage);
