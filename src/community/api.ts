/**
 * Thin typed layer over the Supabase tables in supabase/migrations.
 * Column-level grants apply server-side: inserts send only the allowed columns
 * and never use upsert on community tables (see supabase/README.md).
 */
import { useBookmarks, type Bookmark } from '@/state/bookmarks';
import { requireSupabase } from './supabase';

export interface MinuteComment {
  id: string;
  user_id: string;
  episode_id: string;
  time_sec: number;
  body: string;
  created_at: string;
  profiles: { username: string | null; avatar_url: string | null } | null;
}

export interface Question {
  id: string;
  user_id: string;
  kind: 'question' | 'topic';
  body: string;
  episode_id: string | null;
  status: 'open' | 'planned' | 'answered' | 'archived';
  upvote_count: number;
  created_at: string;
  profiles: { username: string | null } | null;
}

interface BookmarkRow {
  id: string;
  episode_id: string;
  time_sec: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const COMMENT_COLUMNS =
  'id, user_id, episode_id, time_sec, body, created_at, profiles(username, avatar_url)';

export async function listComments(episodeId: string): Promise<MinuteComment[]> {
  const { data, error } = await requireSupabase()
    .from('minute_comments')
    .select(COMMENT_COLUMNS)
    .eq('episode_id', episodeId)
    .order('time_sec', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as MinuteComment[];
}

export async function addComment(episodeId: string, timeSec: number, body: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('minute_comments')
    .insert({
      episode_id: episodeId,
      time_sec: Math.max(0, Math.floor(timeSec)),
      body: body.trim(),
    });
  if (error) throw error;
}

/** Realtime: calls `onChange` whenever a comment is added to the episode. */
export function subscribeComments(episodeId: string, onChange: () => void): () => void {
  const supabase = requireSupabase();
  const channel = supabase
    .channel(`minute_comments:${episodeId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'minute_comments',
        filter: `episode_id=eq.${episodeId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function listQuestions(): Promise<Question[]> {
  const { data, error } = await requireSupabase()
    .from('questions')
    .select(
      'id, user_id, kind, body, episode_id, status, upvote_count, created_at, profiles(username)',
    )
    .in('status', ['open', 'planned'])
    .order('upvote_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as Question[];
}

export async function askQuestion(kind: Question['kind'], body: string): Promise<void> {
  const { error } = await requireSupabase().from('questions').insert({ kind, body: body.trim() });
  if (error) throw error;
}

export async function myVotes(userId: string): Promise<Set<string>> {
  const { data, error } = await requireSupabase()
    .from('question_votes')
    .select('question_id')
    .eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r: { question_id: string }) => r.question_id));
}

export async function setVote(questionId: string, userId: string, on: boolean): Promise<void> {
  const table = requireSupabase().from('question_votes');
  const { error } = on
    ? await table.insert({ question_id: questionId })
    : await table.delete().eq('question_id', questionId).eq('user_id', userId);
  if (error) throw error;
}

/**
 * Two-way bookmark sync, last-write-wins per bookmark id.
 * Local remains the source of truth for the UI; the cloud is a mirror.
 */
export async function syncBookmarks(): Promise<number> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('bookmarks')
    .select('id, episode_id, time_sec, note, created_at, updated_at, deleted_at');
  if (error) throw error;

  const local = useBookmarks.getState().items;
  const merged = new Map<string, Bookmark>(local.map((b) => [b.id, b]));
  const remoteUpdated = new Map<string, number>();
  for (const row of (data ?? []) as BookmarkRow[]) {
    const updatedAt = Date.parse(row.updated_at);
    remoteUpdated.set(row.id, updatedAt);
    const mine = merged.get(row.id);
    if (!mine || updatedAt > mine.updatedAt) {
      merged.set(row.id, {
        id: row.id,
        episodeId: row.episode_id,
        timeSec: row.time_sec,
        note: row.note ?? undefined,
        createdAt: Date.parse(row.created_at),
        updatedAt,
        deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : undefined,
      });
    }
  }

  const toPush = [...merged.values()].filter(
    (b) => !remoteUpdated.has(b.id) || b.updatedAt > remoteUpdated.get(b.id)!,
  );
  if (toPush.length > 0) {
    const push = await supabase.from('bookmarks').upsert(
      toPush.map((b) => ({
        id: b.id,
        episode_id: b.episodeId,
        time_sec: b.timeSec,
        note: b.note ?? null,
        created_at: new Date(b.createdAt).toISOString(),
        deleted_at: b.deletedAt ? new Date(b.deletedAt).toISOString() : null,
      })),
    );
    if (push.error) throw push.error;
  }

  useBookmarks
    .getState()
    .replaceAll([...merged.values()].sort((a, b) => b.createdAt - a.createdAt));
  return merged.size;
}
