import { supabase } from './supabase.js';

export interface StudioRow {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  users: { id: string; email: string; role: string }[];
  projects: { count: number }[];
}

/** Call the `admin` edge function; surfaces the function's error message cleanly. */
async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try {
      const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (body?.error) msg = body.error;
    } catch {
      // keep generic message
    }
    throw new Error(msg);
  }
  return data as T;
}

export const createStudio = (
  studioName: string,
  ownerEmail: string,
  ownerName: string,
  password: string,
) =>
  callAdmin<{ ok: true; ownerId: string; ownerEmail: string }>('create_studio', {
    studioName,
    ownerEmail,
    ownerName,
    password,
  });

export const listStudios = () =>
  callAdmin<{ studios: StudioRow[] }>('list_studios').then((r) => r.studios);

export const resetPassword = (ownerId: string, password: string) =>
  callAdmin<{ ok: true }>('reset_password', { ownerId, password });

/** A readable random password to hand to a studio owner. */
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '@1';
}
