import { THEME_STORAGE_VERSION } from '@/core/persistence/schemaVersions';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { z } from 'zod';
import { guardedStateStorage } from '@/core/persistence/stateStorage';
import { formatMigrations } from '@/core/persistence/formatMigrations';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
      toggleTheme: () => {
        set((state) => {
          const newTheme = state.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', newTheme === 'dark');
          return { theme: newTheme };
        });
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => guardedStateStorage('theme-storage', { id: 'theme', name: '主题选择', version: THEME_STORAGE_VERSION, schema: z.object({ theme: z.enum(['dark', 'light']) }), migrations: formatMigrations('theme') }, localStorage)),
      version: THEME_STORAGE_VERSION,
    }
  )
);

