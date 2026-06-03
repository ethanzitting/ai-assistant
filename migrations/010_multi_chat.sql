-- Step 1: chats table
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_chat_id BIGINT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'private',
    name TEXT,
    policies JSONB DEFAULT '[]',
    notified_at TIMESTAMPTZ,
    last_processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chats_telegram_id ON chats(telegram_chat_id);

-- Step 2: add nullable chat_id to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id);

-- Step 3: backfill — create a chat row for the existing private chat and point all conversation rows at it
DO $$
DECLARE
    v_telegram_chat_id BIGINT;
    v_chat_id UUID;
BEGIN
    SELECT (value)::BIGINT INTO v_telegram_chat_id
    FROM preferences
    WHERE key = 'telegram_chat_id'
    LIMIT 1;

    IF v_telegram_chat_id IS NOT NULL THEN
        INSERT INTO chats (telegram_chat_id, type)
        VALUES (v_telegram_chat_id, 'private')
        ON CONFLICT (telegram_chat_id) DO NOTHING
        RETURNING id INTO v_chat_id;

        IF v_chat_id IS NULL THEN
            SELECT id INTO v_chat_id FROM chats WHERE telegram_chat_id = v_telegram_chat_id;
        END IF;

        UPDATE conversations SET chat_id = v_chat_id WHERE chat_id IS NULL;
    END IF;
END $$;

-- Step 4: index for per-chat queries
CREATE INDEX IF NOT EXISTS idx_conversations_chat_created ON conversations(chat_id, created_at);
