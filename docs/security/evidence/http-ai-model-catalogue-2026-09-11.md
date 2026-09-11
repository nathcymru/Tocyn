# HTTP AI model-cost evidence — 11 September 2026

This is dated provider evidence for the bounded #64 widget chat and staff
suggestion admission envelopes. It does not select a new model, activate a
provider, establish an owner allocation, or claim production readiness.

| Existing model | Bounded use | Provider evidence inspected 11 September 2026 | Admission conversion |
| --- | --- | --- | --- |
| `@cf/baai/bge-large-en-v1.5` | One query embedding | [Model page](https://developers.cloudflare.com/workers-ai/models/bge-large-en-v1.5/) — 512 maximum input tokens, 1,024 output dimensions. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — 18,582 neurons per million input tokens. | Reserve `512 × 18,582 = 9,513,984` micro-neurons and 1,024 queried dimensions. |
| `@cf/meta/llama-3-8b-instruct` | One response: widget max 512 output tokens; staff max 1,024 | [Model page](https://developers.cloudflare.com/ai/models/%40cf/meta/llama-3-8b-instruct/) — 7,968-token context window and **deprecated 30 May 2026**. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — 25,608 neurons per million input tokens and 75,147 per million output tokens. | Reserve the full 7,968-token input context plus the route output maximum, rounded conservatively into the catalogue's micro-neuron integer unit. |

The resource catalogue defines `aiMicroNeurons` as millionths of a neuron and
requires model-specific conversion. Because the provider publishes neurons per
million tokens, the million-token denominator cancels the micro-neuron factor:
`tokens × neurons-per-million-tokens` is the exact integer reservation for
these listed rates. The service must reject rather than infer a different model,
rate, vector dimension, or unallocated `aiMicroNeurons`/
`vectorQueriedDimensions` ceiling.

The deprecated Llama identifier remains unchanged in this bounded maintenance
slice. Replacement selection, provider compatibility, privacy and rate evidence
are separate #161/#64 policy work; an admitted provider failure retains its
charge and produces the deterministic manual fallback.
