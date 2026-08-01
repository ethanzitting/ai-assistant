// A job is plain code on a clock, not a conversation turn. The handler receives its own registered
// name so it can read its own history in job_runs, and returns whatever detail is worth recording.
export type JobHandler = (jobName: string) => Promise<Record<string, unknown>>;
