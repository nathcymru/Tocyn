# Beta.2 continuous coordination

Operational routing rule for the active Beta.2 delivery queue (2026-09-14):

- Keep up to three bounded GPT implementation or acceptance tasks active when slots and allowance permit.
- Keep one free Ollama Cloud `gpt-oss:120b` request active at a time for contained, low-risk work; stop on quota, authentication, or repeated Graphify-request loops.
- Use local Granite 4.2 3B for small repetitive work only when its memory admission guard passes.
- If local admission fails, preserve ChatGPT and active development work. Do not weaken the guard or kill unrelated apps/processes. Recheck only after a real, authorized memory change.
- Every worker returns a proposal or bounded commit; GPT integrates, tests, reviews, and owns release decisions.
- Replace completed workers with the next bounded queue item rather than treating a completed agent as continuously running.

This is an operational delivery rule, not a claim of unlimited worker capacity or uninterrupted background execution.
