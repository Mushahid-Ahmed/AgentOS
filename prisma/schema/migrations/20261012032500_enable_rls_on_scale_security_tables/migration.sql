-- Enable Row Level Security on the two tables the scale/security pass adds, so the
-- rule stays "every table" with no per-table judgement call (docs/rules/auth.md).
-- No policies, and never FORCE: Prisma connects as the owner, and FORCE would
-- subject it to the policies that deliberately do not exist. Enabled with no
-- policies is a deny-by-default lock on the anon/authenticated roles, so the
-- Supabase Data API can never read a rate-limit counter or an audit row even if the
-- Data API is switched on later — which matters more here than anywhere, because a
-- readable counter lets an attacker see how much budget is left and an audit log is
-- a map of who did what.
-- Hand-written on purpose — RLS is not expressible in the Prisma schema — and
-- enforced from here on by `pnpm check:rls` at the end of CI's migrations job.
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
