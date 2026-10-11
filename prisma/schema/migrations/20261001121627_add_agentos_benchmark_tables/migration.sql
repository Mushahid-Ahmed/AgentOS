-- CreateTable
CREATE TABLE "agentos_benchmark_runs" (
    "id" BIGSERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "judge_model" TEXT NOT NULL,
    "generator_model" TEXT NOT NULL,
    "task_count" INTEGER NOT NULL DEFAULT 0,
    "pilot" BOOLEAN NOT NULL DEFAULT false,
    "judge_cost_micro_usd" BIGINT,
    "notes" TEXT,

    CONSTRAINT "agentos_benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentos_benchmark_results" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "task_id" TEXT NOT NULL,
    "setup" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "answer" TEXT,
    "error" TEXT,
    "citations" INTEGER NOT NULL DEFAULT 0,
    "verified_claims" INTEGER NOT NULL DEFAULT 0,
    "contested_claims" INTEGER NOT NULL DEFAULT 0,
    "refuted_claims" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "model_calls" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "replans" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agentos_benchmark_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentos_benchmark_verdicts" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" BIGINT NOT NULL,
    "task_id" TEXT NOT NULL,
    "setup" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "unsupported_claims" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "judge_model" TEXT NOT NULL,

    CONSTRAINT "agentos_benchmark_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agentos_benchmark_runs_started_at_idx" ON "agentos_benchmark_runs"("started_at");

-- CreateIndex
CREATE INDEX "agentos_benchmark_results_run_id_idx" ON "agentos_benchmark_results"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agentos_benchmark_results_run_id_task_id_setup_key" ON "agentos_benchmark_results"("run_id", "task_id", "setup");

-- CreateIndex
CREATE INDEX "agentos_benchmark_verdicts_run_id_idx" ON "agentos_benchmark_verdicts"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agentos_benchmark_verdicts_run_id_task_id_setup_key" ON "agentos_benchmark_verdicts"("run_id", "task_id", "setup");

-- AddForeignKey
ALTER TABLE "agentos_benchmark_results" ADD CONSTRAINT "agentos_benchmark_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agentos_benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentos_benchmark_verdicts" ADD CONSTRAINT "agentos_benchmark_verdicts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agentos_benchmark_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
