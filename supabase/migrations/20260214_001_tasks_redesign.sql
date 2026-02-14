-- Tasks Redesign: agents table + task_messages table
-- Run via Supabase SQL Editor

-- ==================== AGENTS TABLE ====================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT,
  emoji TEXT NOT NULL DEFAULT '🤖',
  color TEXT NOT NULL DEFAULT 'cyan',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed existing agents
INSERT INTO agents (name, display_name, role, emoji, color) VALUES
  ('jeff', 'Jeff', 'AI CTO', '🤖', 'cyan'),
  ('maureen', 'Maureen', 'AI CMO', '👩‍💻', 'pink'),
  ('kip', 'Kip', 'Human', '👤', 'amber')
ON CONFLICT (name) DO NOTHING;

-- ==================== TASK MESSAGES TABLE ====================
CREATE TABLE IF NOT EXISTS task_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key TEXT NOT NULL,
  sender TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'agent' CHECK (sender_type IN ('agent', 'human')),
  message TEXT NOT NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_messages_task_key ON task_messages(task_key);
CREATE INDEX IF NOT EXISTS idx_task_messages_blocking ON task_messages(task_key)
  WHERE is_blocking = true AND is_resolved = false;
