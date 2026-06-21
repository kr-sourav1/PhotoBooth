/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_R2_PUBLIC_BASE_URL: string;
  readonly VITE_GALLERY_BASE_URL: string;
  readonly VITE_STORAGE_BACKEND: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
