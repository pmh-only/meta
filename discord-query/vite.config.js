import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    // Prevent Vite from trying to bundle the native DuckDB module
    external: ['@duckdb/node-api'],
    // Bundle lucide-svelte for SSR — its package exports aren't resolvable by Node directly
    noExternal: ['lucide-svelte']
  }
});
