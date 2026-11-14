import { create } from 'zustand';

export type TabKey = 'episodes' | 'search' | 'glossary' | 'library' | 'settings';

interface NavState {
  tab: TabKey;
  /** Glossary term to open (set when a term is tapped elsewhere). */
  glossarySlug?: string;
  /** Query handed to the search tab (deep links: /?tab=search&q=…). */
  searchQuery?: string;
  setTab: (tab: TabKey) => void;
  openGlossary: (slug: string) => void;
  clearGlossarySlug: () => void;
  openSearch: (query: string) => void;
}

/** Home tab selection lives in a store so any screen can jump to a tab. */
export const useNav = create<NavState>((set) => ({
  tab: 'episodes',
  setTab: (tab) => set({ tab }),
  openGlossary: (glossarySlug) => set({ tab: 'glossary', glossarySlug }),
  clearGlossarySlug: () => set({ glossarySlug: undefined }),
  openSearch: (searchQuery) => set({ tab: 'search', searchQuery }),
}));
