import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Memory records for semantic memory store
export const memoryRecords = pgTable("memory_records", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  namespace: text("namespace").notNull().default("general"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const insertMemoryRecordSchema = createInsertSchema(memoryRecords);
export type MemoryRecord = typeof memoryRecords.$inferSelect;
export type InsertMemoryRecord = z.infer<typeof insertMemoryRecordSchema>;

// Pending actions that require human confirmation
export const pendingActions = pgTable("pending_actions", {
  id: text("id").primaryKey(),
  actionType: text("action_type").notNull(),
  target: text("target"),
  description: text("description").notNull(),
  requestedBy: text("requested_by").notNull(),
  riskLevel: text("risk_level").notNull().default("medium"),
  params: jsonb("params").notNull().default({}),
  approved: boolean("approved"),
  executionOutput: text("execution_output"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const insertPendingActionSchema = createInsertSchema(pendingActions).omit(
  { approved: true, executionOutput: true, resolvedAt: true }
);
export type PendingAction = typeof pendingActions.$inferSelect;
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;

// Agent plans with steps
export const agentPlans = pgTable("agent_plans", {
  id: text("id").primaryKey(),
  task: text("task").notNull(),
  steps: jsonb("steps").notNull().default([]),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AgentPlan = typeof agentPlans.$inferSelect;

// Sandbox run history
export const sandboxRuns = pgTable("sandbox_runs", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  language: text("language").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code").notNull().default(0),
  executionTimeMs: integer("execution_time_ms").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  blockReason: text("block_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type SandboxRun = typeof sandboxRuns.$inferSelect;

// System log entries
export const logEntries = pgTable("log_entries", {
  id: text("id").primaryKey(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type LogEntry = typeof logEntries.$inferSelect;

// ─── Tasks ───────────────────────────────────────────────────────────────────
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | cancelled
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  tags: text("tags").array().notNull().default([]),
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTaskSchema = createInsertSchema(tasks).omit({ completedAt: true });
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("info"), // info | success | warning | error | system
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ read: true });
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// ─── Vision Analyses ──────────────────────────────────────────────────────────
export const visionAnalyses = pgTable("vision_analyses", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  description: text("description").notNull(),
  objects: text("objects").array().notNull().default([]),
  extractedText: text("extracted_text"),
  confidence: integer("confidence").notNull().default(90),
  mimeType: text("mime_type").notNull().default("image/jpeg"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VisionAnalysis = typeof visionAnalyses.$inferSelect;

// ─── Coding Sessions ──────────────────────────────────────────────────────────
export const codingSessions = pgTable("coding_sessions", {
  id: text("id").primaryKey(),
  requirement: text("requirement").notNull(),
  projectName: text("project_name").notNull(),
  framework: text("framework").notNull().default(""),
  language: text("language").notNull().default(""),
  files: jsonb("files").notNull().default([]), // Array<{ path, content, language }>
  status: text("status").notNull().default("building"), // building | complete | error
  totalFiles: integer("total_files").notNull().default(0),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CodingSession = typeof codingSessions.$inferSelect;

// ─── Research Results ─────────────────────────────────────────────────────────
export const researchResults = pgTable("research_results", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  summary: text("summary").notNull(),
  keyPoints: text("key_points").array().notNull().default([]),
  sources: text("sources").array().notNull().default([]),
  depth: text("depth").notNull().default("standard"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ResearchResult = typeof researchResults.$inferSelect;

// ─── Automation Logs ──────────────────────────────────────────────────────────
export const automationLogs = pgTable("automation_logs", {
  id: text("id").primaryKey(),
  operation: text("operation").notNull(),
  target: text("target").notNull(),
  success: boolean("success").notNull(),
  output: text("output"),
  errorMessage: text("error_message"),
  requestedBy: text("requested_by").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AutomationLog = typeof automationLogs.$inferSelect;

/**
 * Autonomous agent runs — every NEXUS task plan and every task NEXUS hands to
 * Jarvis is persisted here so progress, approvals and results are auditable.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    /** "nexus" for the primary assistant, "jarvis" for the subordinate. */
    kind: text("kind").notNull().default("nexus"),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("planning"),
    /** Ordered plan produced by the planner: [{ id, agent, description, ... }] */
    plan: jsonb("plan").notNull().default([]),
    /** Live step state: [{ id, status, output, verification, attempts }] */
    steps: jsonb("steps").notNull().default([]),
    result: text("result"),
    error: text("error"),
    /** Cooperative control signal: run | pause | cancel */
    control: text("control").notNull().default("run"),
    provider: text("provider"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_runs_kind_created_idx").on(table.kind, table.createdAt),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type InsertAgentRun = typeof agentRuns.$inferInsert;
