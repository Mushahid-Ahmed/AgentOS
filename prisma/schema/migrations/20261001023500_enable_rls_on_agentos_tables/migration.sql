-- Enable Row Level Security on the AgentOS tables, so the rule stays
-- "every table" with no per-table judgement call (docs/rules/auth.md). No
-- policies, and never FORCE: Prisma connects as the owner, and FORCE would
-- subject it to the policies that deliberately do not exist. Enabled with no
-- policies is a deny-by-default lock on the anon/authenticated roles, so the
-- Supabase Data API can never read these rows even if it is switched on later.
-- Hand-written on purpose — RLS is not expressible in the Prisma schema — and
-- enforced from here on by `pnpm check:rls` at the end of CI's migrations job.
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_records" ENABLE ROW LEVEL SECURITY;
