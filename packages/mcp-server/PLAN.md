# Airtable Internal MCP Local Scaling Refactor

## Summary
- Keep the server as a local `stdio` MCP and preserve existing tool names for compatibility.
- Refactor around one in-process Airtable session owner that controls the persistent Chrome profile, serializes browser-backed requests, and exposes clear session health/error states.
- Expand the tool surface within base-specific schema and field operations: richer reads, safer field mutations, and `delete_field` in scope now; broader destructive table/view tooling remains design-ready but unshipped.
- Standardize tool results as compact `structuredContent` summaries plus a JSON text mirror for compatibility, with optional `debug: true` returning raw Airtable diagnostics.

## Implementation Changes
- Replace the single global `switch` handler with SDK `registerTool`-based tool modules and explicit input/output schemas.
- Split the current auth/client logic into three layers: session/runtime ownership, cached read services, and capture-backed mutation builders.
- Introduce one browser/profile owner with a global request queue for browser calls; cache hits return immediately, cache misses and all writes go through the queue.
- Treat `getUserProperties` HTTP `200` as session-valid and stop assuming `data.userId` exists; expose identity only when it is actually present in downstream payloads.
- Use `getApplicationScaffoldingData(appId)` only for lightweight table listing and use cached `application/read` for full table/field/view detail.
- Add per-`appId` read caches with a `15s` TTL for scaffolding and full schema payloads; invalidate the full app cache immediately after any successful mutation.
- Rebuild field mutation requests from observed Airtable request shapes instead of heuristic retries; include resolved `activeViewId`, `afterOverallColumnIndex`, `origin`, `schemaDependenciesCheckParams`, `requestId`, and `secretSocketId` when available.
- Implement `secretSocketId` handling inside the session layer: capture and cache it per app when the page exposes it through live request context, include it in write payloads when available, and allow one documented fallback attempt without it before surfacing an error.
- Keep write operations guarded: resolve names to IDs once, re-read schema before mutating, and fail fast on missing targets, mismatched field names, ambiguous names, or unsupported field types.
- Repair the reverse-engineering scripts so they run under the current ESM setup and `patchright` dependency, since future internal endpoint drift is expected.
my Airtable internal MCP. What I am thinking here is to add support for all or most important operations that are only possible in the internal API. I want to skip any operation that is already possible through the official web API.

For example, right now in the current MCP, I added the ability to:
1. Create a computed file
2. Edit a computed file
3. Delete a computed file
4. Rename a computed file

What I need you to do is harden the project and expand it with new abilities to give the AI more and more control within my Airtable. Currently, the MCP is just a prototype and isn't something battle-tested yet; I need your help to make it a battle-tested one.

At the moment, we are focusing on building it as an MCP. In the future, we will convert it into a Visual Studio Code extension.

I have created a simple plan using Codex. I need you to review the plan to see if it's good and do your best to help me achieve what we want to achieve right now.
## Public APIs
- Keep existing tools additive and compatible: `get_base_schema`, `list_fields`, `create_formula_field`, `update_formula_field`, `update_field_config`, and `rename_field`.
- Add `list_tables(appId, debug?)` returning table ids, names, and ordering from scaffolding data.
- Add `get_table_schema(appId, tableIdOrName, debug?)` returning one table’s fields and views from cached full schema data.
- Add `list_views(appId, tableIdOrName, debug?)` returning one table’s view ids, names, and types.
- Add `create_field(appId, tableId, name, fieldType, typeOptions, insertAfterFieldId?, debug?)` as the main generic field-creation entrypoint; `create_formula_field` becomes a thin wrapper over it.
- Keep `update_field_config(appId, fieldId, fieldType, typeOptions, debug?)` as the generic config mutation entrypoint and keep `update_formula_field` as a wrapper.
- Keep `rename_field(appId, fieldId, newName, debug?)` but make it pre-validate the target field before mutation.
- Add `delete_field(appId, fieldId, expectedName, debug?)`; require `fieldId` plus `expectedName` so destructive calls are explicit and name-checked before execution.
- Standardize all tool outputs to return compact `structuredContent` summaries by default and include a `debug` object only when `debug: true`.

## Test Plan
- Add unit tests for tool input validation, table/field resolution, cache hits and invalidation, guarded delete preconditions, and output shaping for normal vs debug mode.
- Add integration tests against a disposable Airtable fixture base/table for `list_tables`, `get_table_schema`, `list_views`, `create_field`, `rename_field`, `update_field_config`, `delete_field`, and cache invalidation after mutation.
- Add a concurrency test proving that parallel MCP calls do not relaunch Chrome or corrupt the persistent profile and instead serialize through the session owner.
- Add failure-path tests for expired sessions, Airtable `404`/`422` responses, HTML error bodies, missing `secretSocketId`, unsupported field types, and `delete_field` expected-name mismatches.
- Add a destructive-tool verification step that captures the real Airtable field-delete request against the fixture base before codifying the final delete request builder.

## Assumptions
- This refactor targets local `stdio` only; no shared remote MCP transport is implemented now.
- Scope stays base/table/view metadata plus field operations; table/view mutation tools do not ship in this pass.
- Destructive tooling shipped now is `delete_field` only; broader destructive schema support is limited to architecture seams and capture tooling for a later pass.
- Existing MCP consumers keep working because current tool names remain valid and new tools are additive.
- Integration and destructive testing use a disposable Airtable sandbox that the logged-in local Chrome profile can safely mutate.
