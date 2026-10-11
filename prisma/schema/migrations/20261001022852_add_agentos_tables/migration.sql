-- CreateTable
CREATE TABLE "agent_runs" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "execution_mode" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "cost_micro_usd" BIGINT,
    "model_calls" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "replans" INTEGER NOT NULL DEFAULT 0,
    "final_answer" TEXT,
    "error" TEXT,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tools_allowed" JSONB NOT NULL,
    "depends_on" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT,
    "output_summary" TEXT,
    "error" TEXT,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_records" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "input_summary" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "decided_by" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "latency_ms" INTEGER NOT NULL,
    "rationale" TEXT,

    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" BIGINT NOT NULL,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "claim" TEXT NOT NULL,
    "source" TEXT,
    "retrieved_text" TEXT,
    "discovered_by_agent" TEXT NOT NULL,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "relation" TEXT NOT NULL DEFAULT 'supports',
    "references_evidence_id" BIGINT,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs"("created_at");

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "agent_steps_run_id_idx" ON "agent_steps"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_run_id_key_key" ON "agent_steps"("run_id", "key");

-- CreateIndex
CREATE INDEX "decision_records_run_id_kind_idx" ON "decision_records"("run_id", "kind");

-- CreateIndex
CREATE INDEX "agent_events_run_id_idx" ON "agent_events"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_run_id_seq_key" ON "agent_events"("run_id", "seq");

-- CreateIndex
CREATE INDEX "evidence_records_run_id_idx" ON "evidence_records"("run_id");

-- CreateIndex
CREATE INDEX "evidence_records_run_id_verification_status_idx" ON "evidence_records"("run_id", "verification_status");

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
