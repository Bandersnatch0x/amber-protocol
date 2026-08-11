"use strict";

// `amber ledger export` — SIEM/compliance bridge. Walks every ledger.jsonl via
// walkLedgers, verifies each chain, and emits JSON / CSV / OTLP-JSON. A broken
// chain is exported as-is with intact:false (data, not refusal) so a SOC can
// see the break; brokenCount surfaces it. Pure read; no external writes.
const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget } = require("./fs-utils");
const { walkLedgers, readLedger, verifyLedgerChain } = require("./loop-ledger");
const { resolveStateDirForRead } = require("../state-dir-resolver");

function collectLedgers(targetRoot) {
	const stateDirAbs = resolveStateDirForRead(targetRoot, { quiet: true });
	if (!fs.existsSync(stateDirAbs)) return { stateDir: null, ledgers: [] };
	const ledgers = [];
	walkLedgers(stateDirAbs, ({ home, sub, ledgerPath }) => {
		const records = readLedger(ledgerPath);
		const v = verifyLedgerChain(ledgerPath);
		ledgers.push({ home, sub, intact: v.intact, recordCount: v.records || 0, records });
	});
	return { stateDir: path.basename(stateDirAbs), ledgers };
}

function exportLedger(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const format = options.format || "json";
	const homeFilter = options.home && options.home !== "all" ? options.home : null;
	const { stateDir, ledgers } = collectLedgers(targetRoot);
	const filtered = homeFilter ? ledgers.filter((l) => l.home === homeFilter) : ledgers;
	const intactCount = filtered.filter((l) => l.intact).length;
	const brokenCount = filtered.length - intactCount;
	const errors = [];
	if (!stateDir) errors.push("no .amber or .harness state directory");
	if (brokenCount > 0)
		errors.push(`${brokenCount} ledger(s) have a broken hash chain (exported with intact:false).`);
	const payload = buildPayload(format, filtered);
	return {
		target: targetRoot,
		stateDir,
		format,
		ledgers: filtered,
		intactCount,
		brokenCount,
		payload,
		errors,
		warnings: [],
	};
}

function buildPayload(format, ledgers) {
	if (format === "csv") return toCsv(ledgers);
	if (format === "otlp-json") return toOtlpJson(ledgers);
	return toJson(ledgers);
}

function toJson(ledgers) {
	return JSON.stringify(
		{
			ledgers: ledgers.map((l) => ({
				home: l.home,
				sub: l.sub,
				intact: l.intact,
				recordCount: l.recordCount,
				records: l.records,
			})),
		},
		null,
		2,
	);
}

function csvField(v) {
	const s = String(v == null ? "" : v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(ledgers) {
	const cols = ["ledger_home", "ledger_sub", "record_index", "kind", "prevHash", "hash"];
	const rows = [cols.join(",")];
	for (const l of ledgers) {
		l.records.forEach((r, i) => {
			rows.push(
				[l.home, l.sub, i, r.kind || "", r.prevHash || "", r.hash || ""].map(csvField).join(","),
			);
		});
	}
	return rows.join("\n");
}

function toOtlpJson(ledgers) {
	// JSON-encoded OTLP (valid OTLP encoding; no protobuf, no dependency).
	// One span per ledger record; traceId/spanId derived from the record hash so
	// the chain structure is preserved in the telemetry backend.
	const spans = [];
	for (const l of ledgers) {
		l.records.forEach((r, i) => {
			const h = r.hash || "";
			spans.push({
				traceId: h.padEnd(32, "0").slice(0, 32),
				spanId: h.slice(0, 16).padEnd(16, "0"),
				name: `amber.ledger.${r.kind || "record"}`,
				attributes: [
					{ key: "amber.ledger.home", value: { stringValue: l.home } },
					{ key: "amber.ledger.sub", value: { stringValue: l.sub } },
					{ key: "amber.ledger.record_index", value: { intValue: String(i) } },
					{ key: "amber.ledger.intact", value: { boolValue: l.intact } },
					{ key: "amber.ledger.prevHash", value: { stringValue: r.prevHash || "" } },
				],
			});
		});
	}
	return JSON.stringify(
		{ resourceSpans: [{ scopeSpans: [{ scope: { name: "amber-protocol-ledger" }, spans }] }] },
		null,
		2,
	);
}

module.exports = { exportLedger, collectLedgers };
