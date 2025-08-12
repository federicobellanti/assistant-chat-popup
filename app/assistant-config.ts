// app/assistant-config.ts
// Use the public env var if set; otherwise fall back to the literal ID.
export const assistantId =
  process.env.NEXT_PUBLIC_ASSISTANT_ID || "asst_ge9zn6BjdwAyyE7Lcf6DmD4e";

// (Optional alias so both names exist, in case other code imports ASSISTANT_ID)
export const ASSISTANT_ID = assistantId;

