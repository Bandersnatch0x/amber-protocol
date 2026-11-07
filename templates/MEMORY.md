# Memory

Durable project knowledge selected by humans. Add constraints, architecture decisions, and facts that should survive across sessions.

## Memory creed — capability, not ceremony

Write to memory only when the entry is:

- a durable operator preference or correction that later sessions must respect;
- a decision that reverses an earlier one, so the outdated answer stops propagating;
- anything a fresh session would otherwise get wrong twice.

Keep out of memory:

- one-off session detail — `notes.md` owns that for the current session;
- anything reconstructible from git history, `feature_list.json`, or the session timeline;
- transient task state that expires with the work it belonged to;
- mechanical facts the repository already records on its own.

Every entry must change a future decision or be deleted.

## Entry format

Each booked entry is a level-3 heading inside the `## Entries` region below. The
heading is the claim's first line; a provenance line records the surface it was
booked from and the first 12 hex characters of that surface's normalized hash:

```text
### <claim first line>
> provenance: MEMORY.md@<normHash first 12>
```

An entry runs from one `### ` line to the next `### ` line (or end of file).
`amber memory status` reports the `### ` lines **inside `## Entries`** and the
whole file's normalized byte size (CRLF→LF, no BOM, no trailing whitespace) as
observation only. Nothing caps those numbers: this creed and the approval gate
curate growth, and gamma still limits new knowledge to five admissions per 168
hours. Refreshing an existing entry's provenance is exempt: a replacement that
keeps the same claim, knowledge kind and target surface as its predecessor
changes only the source bindings, so it does not consume that budget (it still
needs the human approve and book steps).

After editing entries by hand, run `amber memory book` to ratify the change so
the registered surface hash matches the file again — unratified edits surface as
a doctor ratification-class warning.

## Entries

<!-- Booked entries live here as `### ` blocks, one per entry. Empty until the
     first entry is booked; the reported entry count is the number of `### `
     lines in this region. -->
