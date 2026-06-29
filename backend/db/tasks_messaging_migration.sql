-- Staff tasks, task notifications, and clinic messaging.
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'aria', 'system')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  assigned_to UUID,
  created_by UUID,
  patient_id UUID REFERENCES public.patients (id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_clinic_created
  ON public.tasks (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_clinic_status
  ON public.tasks (clinic_id, status);

CREATE TABLE IF NOT EXISTS public.task_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_user_unread
  ON public.task_notifications (clinic_id, user_id, read_at);

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics (id) ON DELETE CASCADE,
  conversation_type TEXT NOT NULL
    CHECK (conversation_type IN ('clinic_wide', 'direct')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_clinic
  ON public.conversations (clinic_id, conversation_type);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON public.conversation_participants (user_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_clinic_access ON public.tasks
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY task_notifications_clinic_access ON public.task_notifications
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY conversations_clinic_access ON public.conversations
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM public.clinic_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY conversation_participants_clinic_access ON public.conversation_participants
  FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE clinic_id IN (
        SELECT clinic_id FROM public.clinic_users
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY messages_clinic_access ON public.messages
  FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE clinic_id IN (
        SELECT clinic_id FROM public.clinic_users
        WHERE user_id = auth.uid()
      )
    )
  );
