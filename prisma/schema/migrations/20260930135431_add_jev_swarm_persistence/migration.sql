-- CreateTable
CREATE TABLE "conversations" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversation_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_events" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_id" BIGINT NOT NULL,
    "chosen_model" TEXT NOT NULL,
    "jev_latency_ms" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "fallback_reason" TEXT,
    "ttft_ms" INTEGER,
    "total_latency_ms" INTEGER,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT,

    CONSTRAINT "route_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_runs" (
    "id" BIGSERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "judge_model" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_results" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "router" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "expected_label" TEXT NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "error" TEXT,

    CONSTRAINT "benchmark_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_updated_at_idx" ON "conversations"("updated_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "route_events_message_id_key" ON "route_events"("message_id");

-- CreateIndex
CREATE INDEX "route_events_created_at_idx" ON "route_events"("created_at");

-- CreateIndex
CREATE INDEX "route_events_chosen_model_idx" ON "route_events"("chosen_model");

-- CreateIndex
CREATE INDEX "benchmark_runs_started_at_idx" ON "benchmark_runs"("started_at");

-- CreateIndex
CREATE INDEX "benchmark_results_run_id_idx" ON "benchmark_results"("run_id");

-- CreateIndex
CREATE INDEX "benchmark_results_router_idx" ON "benchmark_results"("router");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_events" ADD CONSTRAINT "route_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
