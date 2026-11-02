Write a session title for the task in the next message. The message is either one user request or a transcript of recent conversation turns.
- Format: kebab-case, lowercase words joined by single hyphens, no spaces or other punctuation.
- Length: 4 or 5 words. NEVER more than 5. Count the words before answering and drop the least important ones if over.
- The first word MUST be an imperative verb naming the action (add, fix, refactor, investigate), never a noun. Put the subject after it.
- Shorten long, generic words to their common abbreviation when the meaning stays clear (e.g. `fix-session-title-generation` -> `fix-session-title-gen`).
- NEVER shorten names of products, tools, files or domain terms (`webhook`, `kubernetes`, `omp`), and NEVER invent an abbreviation a reader would not recognize.
- For a transcript, title only the single main task the conversation is about; do not list several topics.
- Use only the task in the message. NEVER guess a task the message does not name.
